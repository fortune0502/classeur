angular.module('classeur.core.sync', [])
	.factory('clSyncSvc', function($rootScope, $location, $http, $timeout, clToast, clUserSvc, clUserInfoSvc, clFileSvc, clFolderSvc, clClasseurSvc, clSocketSvc, clSetInterval, clEditorSvc, clSyncUtils, clLocalStorageObject) {
		var lastCreateFileActivity = 0;
		var maxSyncInactivity = 30 * 1000; // 30 sec
		var createFileTimeout = 30 * 1000; // 30 sec
		var loadingTimeout = 30 * 1000; // 30 sec

		var syncDataStore = clLocalStorageObject('syncData');

		var init = true;

		function readSyncDataStore(ctx) {
			function parseSyncData(data) {
				return JSON.parse(data, function(id, value) {
					return typeof value === 'number' && id !== 'r' && id !== 's' ? {
						r: value
					} : value;
				});
			}
			var checkSyncDataUpdate = syncDataStore.$checkGlobalUpdate();
			if (!init && !checkSyncDataUpdate) {
				return;
			}
			syncDataStore.$readAttr('lastActivity', '0', parseInt);
			syncDataStore.$readAttr('folders', '{}', parseSyncData);
			syncDataStore.$readAttr('lastFolderSeq', '0', parseInt);
			syncDataStore.$readAttr('files', '{}', parseSyncData);
			syncDataStore.$readAttr('lastFileSeq', '0', parseInt);
			syncDataStore.$readAttr('userId', '');
			syncDataStore.$readAttr('userData', '{}', parseSyncData);
			syncDataStore.$readAttr('fileSyncReady', '');
			init = false;
			return ctx && ctx.userId && checkUserChange(ctx.userId);
		}

		function writeSyncDataStore(lastActivity) {
			function serializeSyncData(data) {
				return JSON.stringify(data, function(id, value) {
					return (!value.s && value.r) || value;
				});
			}
			syncDataStore.lastActivity = lastActivity !== undefined ? lastActivity : Date.now();
			syncDataStore.$writeAttr('lastActivity');
			syncDataStore.$writeAttr('folders', serializeSyncData);
			syncDataStore.$writeAttr('lastFolderSeq');
			syncDataStore.$writeAttr('files', serializeSyncData);
			syncDataStore.$writeAttr('lastFileSeq');
			syncDataStore.$writeAttr('userId');
			syncDataStore.$writeAttr('userData', serializeSyncData);
			syncDataStore.$writeAttr('fileSyncReady');
		}

		function checkUserChange(userId) {
			if (userId !== syncDataStore.userId) {
				// Clear sync data
				var fileKeyPrefix = /^(cr\.|syncData\.)/;
				for (var key in localStorage) {
					if (key.match(fileKeyPrefix)) {
						localStorage.removeItem(key);
					}
				}
				// Remove files that are not local
				var filesToRemove = clFileSvc.files.filter(function(fileDao) {
					return !fileDao.contentDao.isLocal;
				});
				clFileSvc.removeFiles(filesToRemove);
				readSyncDataStore();
				syncDataStore.userId = userId;
				writeSyncDataStore(0);
				return true;
			}
		}

		clSocketSvc.addMsgHandler('userToken', function(msg) {
			readSyncDataStore();
			checkUserChange(msg.userId);
			clFileSvc.files.forEach(function(fileDao) {
				if (fileDao.userId === msg.userId) {
					fileDao.userId = '';
				}
			});
		});

		var contentRevStore = clLocalStorageObject('cr');

		(function() {
			var fileKeyPrefix = /^cr\.(\w\w+)/;
			for (var key in localStorage) {
				var fileDao, match = key.match(fileKeyPrefix);
				if (match) {
					fileDao = clFileSvc.fileMap[match[1]];
					if (!fileDao || !fileDao.contentDao.isLocal) {
						localStorage.removeItem(key);
					}
				}
			}
		})();


		/***
		User
		***/

		var syncUser = (function() {

			function retrieveChanges() {
				clSocketSvc.sendMsg({
					type: 'getUserData',
					userUpdated: (syncDataStore.userData.user || {}).r,
					classeursUpdated: (syncDataStore.userData.classeurs || {}).r
				});
			}

			clSocketSvc.addMsgHandler('userData', function(msg, ctx) {
				if (readSyncDataStore(ctx)) {
					return;
				}
				var apply, syncData;
				if (msg.user) {
					syncData = syncDataStore.userData.user || {};
					if (syncData.s !== msg.userUpdated) {
						clUserSvc.user = msg.user;
						clUserSvc.write(msg.userUpdated);
						syncDataStore.lastUserUpdated = msg.userUpdated;
						apply = true;
					}
					syncDataStore.userData.user = {
						r: msg.userUpdated
					};
				}
				if (msg.classeurs) {
					syncData = syncDataStore.userData.classeurs || {};
					if (syncData.s !== msg.classeursUpdated) {
						clClasseurSvc.classeurs = msg.classeurs;
						clClasseurSvc.init();
						clClasseurSvc.write(msg.classeursUpdated);
						syncDataStore.lastClasseursUpdated = msg.classeursUpdated;
						apply = true;
					}
					syncDataStore.userData.classeurs = {
						r: msg.classeursUpdated
					};
				}
				apply && $rootScope.$evalAsync();
				sendChanges();
				writeSyncDataStore();
			});

			function sendChanges() {
				var syncData, msg = {
					type: 'setUserData'
				};
				syncData = syncDataStore.userData.user || {};
				if (clUserSvc.updated !== syncData.r) {
					msg.user = clUserSvc.user;
					msg.userUpdated = clUserSvc.updated;
					syncData.s = clUserSvc.updated;
					syncDataStore.userData.user = syncData;
				}
				syncData = syncDataStore.userData.classeurs || {};
				if (clClasseurSvc.updated !== syncData.r) {
					msg.classeurs = JSON.parse(clClasseurSvc.serializer(clClasseurSvc.classeurs));
					msg.classeursUpdated = clClasseurSvc.updated;
					syncData.s = clClasseurSvc.updated;
					syncDataStore.userData.classeurs = syncData;
				}
				Object.keys(msg).length > 1 && clSocketSvc.sendMsg(msg);
			}

			return retrieveChanges;
		})();


		/******
		Folders
		******/

		var syncFolders = (function() {

			function retrieveChanges() {
				clSocketSvc.sendMsg({
					type: 'getFolderChanges',
					lastSeq: syncDataStore.lastFolderSeq
				});
			}

			var expectedFolderDeletions = [];
			clSocketSvc.addMsgHandler('folderChanges', function(msg, ctx) {
				if (readSyncDataStore(ctx)) {
					return;
				}
				var foldersToUpdate = [];
				msg.changes.forEach(function(change) {
					var folderDao = clFolderSvc.folderMap[change.id];
					var syncData = syncDataStore.folders[change.id] || {};
					if (syncData.s !== change.updated) {
						/*jshint -W018 */
						if (!change.deleted === !folderDao ||
							(folderDao && folderDao.updated != change.updated && syncData.r !== change.updated && syncData.s !== change.updated)
						) {
							foldersToUpdate.push(change);
						}
						/*jshint +W018 */
					}
					if (change.deleted) {
						delete syncDataStore.folders[change.id];
					} else {
						syncDataStore.folders[change.id] = {
							r: change.updated
						};
					}
					syncDataStore.lastFolderSeq = change.seq;
				});
				expectedFolderDeletions.forEach(function(id) {
					// Assume folders have been deleted, even if the server doesn't tell anything
					delete syncDataStore.folders[id];
				});
				if (foldersToUpdate.length) {
					clFolderSvc.updateFolders(foldersToUpdate);
					$rootScope.$evalAsync();
				}
				if (msg.lastSeq) {
					syncDataStore.lastFolderSeq = msg.lastSeq;
					retrieveChanges();
				} else {
					sendChanges();
				}
				writeSyncDataStore();
			});

			function sendChanges() {
				var changes = [];
				clFolderSvc.folders.forEach(function(folderDao) {
					var syncData = syncDataStore.folders[folderDao.id] || {};
					if (!folderDao.name || folderDao.updated == syncData.r) {
						return;
					}
					changes.push({
						id: folderDao.id,
						name: folderDao.name,
						sharing: folderDao.sharing || undefined,
						updated: folderDao.updated
					});
					syncData.s = folderDao.updated;
					syncDataStore.folders[folderDao.id] = syncData;
				});
				// Check deleted folders
				expectedFolderDeletions = [];
				angular.forEach(syncDataStore.folders, function(syncData, id) {
					if (!clFolderSvc.folderMap.hasOwnProperty(id)) {
						expectedFolderDeletions.push(id);
						changes.push({
							id: id,
							deleted: true
						});
					}
				});
				changes.length && clSocketSvc.sendMsg({
					type: 'setFolderChanges',
					changes: changes
				});
			}

			return retrieveChanges;
		})();


		/****
		Files
		****/

		var syncFiles = (function() {

			function retrieveChanges() {
				clSocketSvc.sendMsg({
					type: 'getFileChanges',
					lastSeq: syncDataStore.lastFileSeq
				});
			}

			var expectedFileDeletions = [];
			clSocketSvc.addMsgHandler('fileChanges', function(msg, ctx) {
				if (readSyncDataStore(ctx)) {
					return;
				}
				var filesToUpdate = [];
				msg.changes.forEach(function(change) {
					var fileDao = clFileSvc.fileMap[change.id];
					var syncData = syncDataStore.files[change.id] || {};
					if (syncData.s !== change.updated) {
						/*jshint -W018 */
						if (!change.deleted === !fileDao ||
							(fileDao && fileDao.updated != change.updated && syncData.r !== change.updated && syncData.s !== change.updated)
						) {
							filesToUpdate.push(change);
						}
						/*jshint +W018 */
					}
					if (change.deleted) {
						delete syncDataStore.files[change.id];
					} else {
						syncDataStore.files[change.id] = {
							r: change.updated
						};
					}
					syncDataStore.lastFileSeq = change.seq;
				});
				expectedFileDeletions.forEach(function(id) {
					// Assume files have been deleted, even if the server doesn't tell anything
					delete syncDataStore.files[id];
				});
				if (filesToUpdate.length) {
					clFileSvc.updateFiles(filesToUpdate);
					$rootScope.$evalAsync();
				}
				if (msg.lastSeq) {
					syncDataStore.lastFileSeq = msg.lastSeq;
					retrieveChanges();
				} else {
					sendChanges();
				}
				writeSyncDataStore();
			});

			function sendChanges() {
				var changes = [];
				clFileSvc.files.forEach(function(fileDao) {
					var syncData = syncDataStore.files[fileDao.id] || {};
					// Check that the file was previously created
					if (!syncData.r || fileDao.userId || !fileDao.name || fileDao.updated == syncData.r) {
						return;
					}
					changes.push({
						id: fileDao.id,
						name: fileDao.name,
						folderId: fileDao.folderId || undefined,
						sharing: fileDao.sharing || undefined,
						updated: fileDao.updated
					});
					syncData.s = fileDao.updated;
					syncDataStore.files[fileDao.id] = syncData;
				});
				// Check deleted files
				expectedFileDeletions = [];
				angular.forEach(syncDataStore.files, function(syncData, id) {
					if (!clFileSvc.fileMap.hasOwnProperty(id)) {
						expectedFileDeletions.push(id);
						changes.push({
							id: id,
							deleted: true
						});
					}
				});
				changes.length && clSocketSvc.sendMsg({
					type: 'setFileChanges',
					changes: changes
				});
				syncDataStore.fileSyncReady = '1';
			}

			return retrieveChanges;
		})();


		/********
		New files
		********/

		function isFilePendingCreation(fileDao) {
			return !fileDao.userId && fileDao.contentDao.isLocal && !syncDataStore.files.hasOwnProperty(fileDao.id);
		}

		var expectedFileCreations = {};
		var sendNewFiles = (function() {
			function sendNewFiles() {
				expectedFileCreations = {};
				clFileSvc.files.filter(isFilePendingCreation).forEach(function(fileDao) {
					expectedFileCreations[fileDao.id] = true;
					fileDao.loadExecUnload(function() {
						clSocketSvc.sendMsg({
							type: 'createFile',
							id: fileDao.id,
							txt: fileDao.contentDao.txt || '\n'
						});
						lastCreateFileActivity = Date.now();
					});
				});
			}

			clSocketSvc.addMsgHandler('contentRev', function(msg, ctx) {
				if (readSyncDataStore(ctx)) {
					return;
				}
				lastCreateFileActivity = Date.now();
				delete expectedFileCreations[msg.id];
				syncDataStore.files[msg.id] = {
					r: -1
				};
				contentRevStore[msg.id] = msg.rev;
				contentRevStore.$writeAttr(msg.id);
				writeSyncDataStore();
			});

			return sendNewFiles;
		})();


		/******
		Content
		******/

		var watchCtx;

		function setWatchCtx(ctx) {
			watchCtx = ctx;
			clSyncSvc.watchCtx = ctx;
		}
		var unsetWatchCtx = setWatchCtx.bind(undefined, undefined);
		clSocketSvc.addMsgHandler('userToken', unsetWatchCtx);

		function watchContent(fileDao) {
			if (!fileDao || !fileDao.state || fileDao.isReadOnly || isFilePendingCreation(fileDao) || (watchCtx && fileDao === watchCtx.fileDao)) {
				return;
			}
			contentRevStore.$readAttr(fileDao.id, '0', parseInt);
			setWatchCtx({
				fileDao: fileDao,
				rev: contentRevStore[fileDao.id],
				userActivities: {},
				contentChanges: []
			});
			clSocketSvc.sendMsg({
				type: 'startWatchContent',
				id: fileDao.id,
				userId: fileDao.userId || undefined,
				previousRev: watchCtx.rev
			});
			$timeout.cancel(fileDao.loadingTimeoutId);
			fileDao.loadingTimeoutId = $timeout(function() {
				setLoadingError(fileDao, 'Loading timeout.');
			}, loadingTimeout);
		}

		function stopWatchContent() {
			if (watchCtx && watchCtx.fileDao) {
				clSocketSvc.sendMsg({
					type: 'stopWatchContent'
				});
				unsetWatchCtx();
			}
		}

		function setFileStateLoaded(fileDao) {
			fileDao.contentDao.isLocal = '1';
			fileDao.contentDao.discussions = {};
			fileDao.contentDao.state = {};
			fileDao.writeContent(true);
			fileDao.state = 'loaded';
			if (!clFileSvc.fileMap.hasOwnProperty(fileDao.id)) {
				clFileSvc.fileMap[fileDao.id] = fileDao;
				clFileSvc.fileIds.push(fileDao.id);
			}
			clFileSvc.init();
		}

		function setLoadingError(fileDao, error) {
			if (fileDao.state === 'loading') {
				fileDao.state = undefined;
			}
			clToast(error || 'The file is not accessible.');
		}

		clSocketSvc.addMsgHandler('file', function(msg) {
			if (!watchCtx || !watchCtx.fileDao.state || watchCtx.fileDao.id !== msg.id) {
				return;
			}
			var fileDao = watchCtx.fileDao;
			$timeout.cancel(fileDao.loadingTimeoutId);
			if (msg.error) {
				return setLoadingError(fileDao);
			}
			if (fileDao.userId) {
				// If file is from another user, that's the only chance we have to update its properties
				fileDao.name = msg.name;
				fileDao.sharing = msg.sharing;
				fileDao.updated = msg.updated;
				fileDao.write(fileDao.updated);
			}
			if (fileDao.state === 'loading') {
				watchCtx.txt = msg.latest.txt;
				watchCtx.rev = msg.latest.rev;
				fileDao.contentDao.txt = watchCtx.txt;
				setFileStateLoaded(fileDao);
				$rootScope.$evalAsync();
			} else {
				var oldTxt = msg.previous ? msg.previous.txt : msg.latest.txt;
				var serverTxt = msg.latest.txt;
				var localTxt = clEditorSvc.cledit.getContent();
				var isServerTxtChanges = oldTxt !== serverTxt;
				var isLocalTxtChanges = oldTxt !== localTxt;
				var isTxtSynchronized = serverTxt === localTxt;
				if (!isTxtSynchronized && isServerTxtChanges && isLocalTxtChanges) {
					// TODO Deal with conflict
					watchCtx.txt = msg.latest.txt;
					watchCtx.rev = msg.latest.rev;
					clEditorSvc.setContent(watchCtx.txt);
				} else {
					watchCtx.txt = msg.latest.txt;
					watchCtx.rev = msg.latest.rev;
					if (!isTxtSynchronized) {
						if (isServerTxtChanges) {
							clEditorSvc.setContent(watchCtx.txt);
						}
					}
				}
			}
			contentRevStore[msg.id] = watchCtx.rev;
			contentRevStore.$writeAttr(msg.id);
			msg.latest.userIds.forEach(clUserInfoSvc.request);
		});

		function getPublicFile(fileDao) {
			if (!fileDao || !fileDao.state || !fileDao.userId) {
				return;
			}
			$http.get('/api/users/' + fileDao.userId + '/files/' + fileDao.id, {
					timeout: loadingTimeout
				})
				.success(function(res) {
					fileDao.name = res.name;
					fileDao.sharing = res.sharing;
					fileDao.updated = res.updated;
					fileDao.write(fileDao.updated);
					if (fileDao.state === 'loaded') {
						clEditorSvc.setContent(res.txt);
					} else if (fileDao.state === 'loading') {
						fileDao.contentDao.txt = res.txt;
						setFileStateLoaded(fileDao);
					}
				})
				.error(function() {
					setLoadingError(fileDao);
				});
		}


		/**************
		Content changes
		**************/

		function sendContentChange() {
			if (!watchCtx || watchCtx.txt === undefined || watchCtx.sentMsg) {
				return;
			}
			// if(watchCtx.fileDao.userId && (watchCtx.fileDao.sharing !== 'rw' || clUserSvc.user.plan !== 'premium')) {
			if (watchCtx.fileDao.userId && watchCtx.fileDao.sharing !== 'rw') {
				return;
			}
			var newTxt = clEditorSvc.cledit.getContent();
			var txtChanges = clSyncUtils.getPatches(watchCtx.txt, newTxt);
			if (!txtChanges.length) {
				return;
			}
			var newRev = watchCtx.rev + 1;
			watchCtx.sentMsg = {
				type: 'setContentChange',
				rev: newRev,
				txt: txtChanges
			};
			clSocketSvc.sendMsg(watchCtx.sentMsg);
		}

		clSocketSvc.addMsgHandler('contentChange', function(msg) {
			if (!watchCtx || watchCtx.fileDao.id !== msg.id || watchCtx.rev >= msg.rev) {
				return;
			}
			watchCtx.contentChanges[msg.rev] = msg;
			var serverTxt = watchCtx.txt;
			var localTxt = clEditorSvc.cledit.getContent();
			while ((msg = watchCtx.contentChanges[watchCtx.rev + 1])) {
				watchCtx.rev = msg.rev;
				watchCtx.contentChanges[msg.rev] = undefined;
				var oldTxt = serverTxt;
				if (!msg.userId && watchCtx.sentMsg && msg.rev === watchCtx.sentMsg.rev) {
					// This has to be the previously sent message
					msg = watchCtx.sentMsg;
				}
				serverTxt = clSyncUtils.applyPatches(serverTxt, msg.txt);
				if (msg !== watchCtx.sentMsg) {
					var isServerTxtChanges = oldTxt !== serverTxt;
					var isLocalTxtChanges = oldTxt !== localTxt;
					var isTxtSynchronized = serverTxt === localTxt;
					if (!isTxtSynchronized && isServerTxtChanges) {
						if (isLocalTxtChanges) {
							localTxt = clSyncUtils.quickPatch(oldTxt, serverTxt, localTxt);
						} else {
							localTxt = serverTxt;
						}
						var offset = clEditorSvc.setContent(localTxt);
						var userActivity = watchCtx.userActivities[msg.userId] || {};
						userActivity.offset = offset;
						watchCtx.userActivities[msg.userId] = userActivity;
					}
					clUserInfoSvc.request(msg.userId);
				}
				watchCtx.sentMsg = undefined;
			}
			watchCtx.txt = serverTxt;
			contentRevStore[watchCtx.fileDao.id] = watchCtx.rev;
			contentRevStore.$writeAttr(watchCtx.fileDao.id);
		});

		clSetInterval(function() {
			readSyncDataStore(clSocketSvc.ctx);
			// Remove files that are not local and not going to be synced
			var filesToRemove = clFileSvc.files.filter(function(fileDao) {
				return !fileDao.contentDao.isLocal && !syncDataStore.files.hasOwnProperty(fileDao.id);
			});
			if (filesToRemove.length) {
				clFileSvc.removeFiles(filesToRemove);
				$rootScope.$apply();
			}
			if (!clSocketSvc.isOnline()) {
				return;
			}
			if (Date.now() - syncDataStore.lastActivity > maxSyncInactivity) {
				// Retrieve and send user/files/folders modifications
				syncUser();
				syncFolders();
				syncFiles();
				writeSyncDataStore();
			}
			// Send new files
			if (Object.keys(expectedFileCreations).length === 0) {
				lastCreateFileActivity = 0;
			}
			if (syncDataStore.fileSyncReady && Date.now() - lastCreateFileActivity > createFileTimeout) {
				sendNewFiles();
			}
		}, 1100, false, true);

		$rootScope.$watch('currentFileDao', function(currentFileDao) {
			if (clSocketSvc.isOnline()) {
				readSyncDataStore(clSocketSvc.ctx);
				stopWatchContent();
				watchContent(currentFileDao);
			} else {
				getPublicFile(currentFileDao);
			}
		});
		clSetInterval(function() {
			if (readSyncDataStore(clSocketSvc.ctx)) {
				stopWatchContent();
			}
			watchContent($rootScope.currentFileDao);
			sendContentChange();
		}, 250, true);

		var clSyncSvc = {};
		return clSyncSvc;
	})
	.factory('clSyncUtils', function($window) {
		var diffMatchPatch = new $window.diff_match_patch();
		var DIFF_DELETE = -1;
		var DIFF_INSERT = 1;
		var DIFF_EQUAL = 0;

		function getPatches(oldContent, newContent) {
			var diffs = diffMatchPatch.diff_main(oldContent, newContent);
			diffMatchPatch.diff_cleanupEfficiency(diffs);
			var patches = [];
			var startOffset = 0;
			diffs.forEach(function(change) {
				var changeType = change[0];
				var changeText = change[1];
				switch (changeType) {
					case DIFF_EQUAL:
						startOffset += changeText.length;
						break;
					case DIFF_DELETE:
						patches.push({
							off: startOffset,
							del: changeText
						});
						break;
					case DIFF_INSERT:
						patches.push({
							off: startOffset,
							ins: changeText
						});
						startOffset += changeText.length;
						break;
				}
			});
			return patches;
		}

		function applyPatches(txt, patches) {
			if (!patches) {
				return txt;
			}
			return patches.reduce(function(txt, change) {
				if (change.ins) {
					return txt.slice(0, change.off) + change.ins + txt.slice(change.off);
				} else if (change.del) {
					return txt.slice(0, change.off) + txt.slice(change.off + change.del.length);
				} else {
					return txt;
				}
			}, txt);
		}

		function quickPatch(oldTxt, newTxt, destTxt) {
			var diffs = diffMatchPatch.diff_main(oldTxt, newTxt);
			var patches = diffMatchPatch.patch_make(oldTxt, diffs);
			var patchResult = diffMatchPatch.patch_apply(patches, destTxt);
			return patchResult[0];
		}

		return {
			getPatches: getPatches,
			applyPatches: applyPatches,
			quickPatch: quickPatch
		};
	});
