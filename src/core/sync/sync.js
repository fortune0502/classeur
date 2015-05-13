angular.module('classeur.core.sync', [])
	.factory('clSyncDataSvc', function(clLocalStorage, clLocalStorageObject, clFileSvc, clFolderSvc, clSocketSvc) {
		var cleanPublicFileAfter = 86400000; // 1 day

		function parseSyncData(data) {
			return JSON.parse(data, function(id, value) {
				return typeof value === 'number' && id !== 'r' && id !== 's' ? {
					r: value
				} : value;
			});
		}

		function serializeSyncData(data) {
			return JSON.stringify(data, function(id, value) {
				return (value && !value.s && value.r) || value;
			});
		}

		var clSyncDataSvc = clLocalStorageObject('syncData', {
			lastActivity: {
				default: '0',
				parser: parseInt
			},
			folders: {
				default: '{}',
				parser: parseSyncData,
				serializer: serializeSyncData,
			},
			nextFolderSeq: {
				default: '0',
				parser: parseInt
			},
			files: {
				default: '{}',
				parser: parseSyncData,
				serializer: serializeSyncData,
			},
			nextFileSeq: {
				default: '0',
				parser: parseInt
			},
			userId: {},
			userData: {
				default: '{}',
				parser: parseSyncData,
				serializer: serializeSyncData,
			},
			fileSyncReady: {},
			publicFolders: {
				default: '{}',
				parser: JSON.parse,
				serializer: JSON.stringify,
			}

		});

		function reset() {
			var fileKeyPrefix = /^syncData\./;
			Object.keys(clLocalStorage).forEach(function(key) {
				if (key.match(fileKeyPrefix)) {
					clLocalStorage.removeItem(key);
				}
			});
			read();
		}

		var initialized;

		function checkUserChange(userId) {
			if (userId !== clSyncDataSvc.userId) {
				var filesToRemove = clFileSvc.files.filter(function(fileDao) {
					if (clSyncDataSvc.files.hasOwnProperty(fileDao.id)) {
						fileDao.isPublic = '1';
						return !fileDao.contentDao.isLocal;
					}
				});
				clFileSvc.removeFiles(filesToRemove); // Free up some space
				clFileSvc.checkAll();

				clFolderSvc.folders.forEach(function(folderDao) {
					if (clSyncDataSvc.folders.hasOwnProperty(folderDao.id)) {
						folderDao.isPublic = '1';
					}
				});
				clFolderSvc.checkAll();

				reset();
				clSyncDataSvc.userId = userId;
				// Force sync
				write(1);
				return true;
			}
		}

		function read(ctx) {
			var checkSyncDataUpdate = clSyncDataSvc.$checkUpdate();
			if (initialized && !checkSyncDataUpdate) {
				return;
			}

			clSyncDataSvc.$read();
			clSyncDataSvc.$readUpdate();

			if (!initialized) {
				clSyncDataSvc.files = Object.keys(clSyncDataSvc.files).reduce(function(files, id) {
					if (clFileSvc.fileMap.hasOwnProperty(id)) {
						files[id] = clSyncDataSvc.files[id];
					}
					return files;
				}, {});
				clSyncDataSvc.folders = Object.keys(clSyncDataSvc.folders).reduce(function(folders, id) {
					if (clFolderSvc.folderMap.hasOwnProperty(id)) {
						folders[id] = clSyncDataSvc.folders[id];
					}
					return folders;
				}, {});

				// Clean up public files
				var currentDate = Date.now();
				Object.keys(clSyncDataSvc.publicFolders).forEach(function(folderId) {
					if (currentDate - clSyncDataSvc.publicFolders[folderId] > cleanPublicFileAfter) {
						delete clSyncDataSvc.publicFolders[folderId];
					}
				});
				clFileSvc.removeFiles(clFileSvc.files.filter(function(fileDao) {
					if (fileDao.isPublic &&
						!fileDao.contentDao.isLocal &&
						(!fileDao.folderId || !clSyncDataSvc.publicFolders.hasOwnProperty(fileDao.folderId))
					) {
						return true;
					}
				}));

				initialized = true;
			}

			return ctx && ctx.userId && checkUserChange(ctx.userId);
		}

		function write(lastActivity) {
			clSyncDataSvc.lastActivity = lastActivity || Date.now();
			clSyncDataSvc.$write();
		}

		clSocketSvc.addMsgHandler('userToken', function(msg) {
			read();
			checkUserChange(msg.userId);
		});

		function isFilePendingCreation(fileDao) {
			return !fileDao.isPublic && fileDao.contentDao.isLocal && !clSyncDataSvc.files.hasOwnProperty(fileDao.id);
		}

		function updatePublicFileMetadata(fileDao, metadata) {
			fileDao.refreshed = Date.now();
			// File permission can change without metadata update
			if (metadata.updated && (!fileDao.lastUpdated || metadata.updated !== fileDao.lastUpdated || fileDao.sharing !== metadata.permission)) {
				fileDao.name = metadata.name;
				// For external files we take the permission as the file sharing
				fileDao.sharing = metadata.permission;
				fileDao.updated = metadata.updated;
				fileDao.write(fileDao.updated);
			}
		}

		function updatePublicFolderMetadata(folderDao, metadata) {
			if (metadata.updated && (!folderDao.lastUpdated || metadata.updated !== folderDao.lastUpdated)) {
				folderDao.name = metadata.name;
				folderDao.sharing = metadata.sharing;
				folderDao.updated = Date.now();
				folderDao.write(folderDao.updated);
			}
		}

		clSyncDataSvc.read = read;
		clSyncDataSvc.write = write;
		clSyncDataSvc.isFilePendingCreation = isFilePendingCreation;
		clSyncDataSvc.updatePublicFileMetadata = updatePublicFileMetadata;
		clSyncDataSvc.updatePublicFolderMetadata = updatePublicFolderMetadata;
		clSyncDataSvc.loadingTimeout = 30 * 1000; // 30 sec

		read();
		return clSyncDataSvc;
	})
	.factory('clContentRevSvc', function(clLocalStorage, clFileSvc) {
		var contentRevKeyPrefix = 'cr.';

		var fileKeyPrefix = /^cr\.(\w\w+)/;
		Object.keys(clLocalStorage).forEach(function(key) {
			var fileDao, match = key.match(fileKeyPrefix);
			if (match) {
				fileDao = clFileSvc.fileMap[match[1]];
				if (!fileDao || !fileDao.contentDao.isLocal) {
					clLocalStorage.removeItem(key);
				}
			}
		});

		return {
			setRev: function(fileId, rev) {
				clLocalStorage.setItem(contentRevKeyPrefix + fileId, rev);
			},
			getRev: function(fileId) {
				var rev = parseInt(clLocalStorage.getItem(contentRevKeyPrefix + fileId));
				return isNaN(rev) ? undefined : rev;
			}
		};
	})
	.factory('clSyncSvc', function($rootScope, $location, $http, $window, clToast, clUserSvc, clFileSvc, clFolderSvc, clClasseurSvc, clSettingSvc, clLocalSettingSvc, clSocketSvc, clUserActivity, clSetInterval, clSyncUtils, clSyncDataSvc, clContentRevSvc) {
		var clSyncSvc = {};
		var nameMaxLength = 128;
		var maxSyncInactivity = 30 * 1000; // 30 sec
		var createFileTimeout = 30 * 1000; // 30 sec
		var recoverFileTimeout = 30 * 1000; // 30 sec
		var sendMetadataAfter = clToast.hideDelay + 2000; // 8 sec (more than toast duration to handle undo)


		/***
		User
		***/

		var syncUser = (function() {

			function retrieveChanges() {
				clSocketSvc.sendMsg({
					type: 'getUserData',
					userUpdated: clUserSvc.user && (clSyncDataSvc.userData.user || {}).r,
					classeursUpdated: (clSyncDataSvc.userData.classeurs || {}).r,
					settingsUpdated: (clSyncDataSvc.userData.settings || {}).r
				});
			}

			clSocketSvc.addMsgHandler('userData', function(msg, ctx) {
				if (clSyncDataSvc.read(ctx)) {
					return;
				}
				var apply, syncData;
				if (msg.user) {
					syncData = clSyncDataSvc.userData.user || {};
					if (syncData.s !== msg.userUpdated) {
						clUserSvc.user = msg.user;
						clUserSvc.write(msg.userUpdated);
						apply = true;
					}
					clSyncDataSvc.userData.user = {
						r: msg.userUpdated
					};
				}
				if (msg.classeurs) {
					syncData = clSyncDataSvc.userData.classeurs || {};
					if (syncData.s !== msg.classeursUpdated) {
						clClasseurSvc.init(msg.classeurs);
						clClasseurSvc.write(msg.classeursUpdated);
						apply = true;
					}
					clSyncDataSvc.userData.classeurs = {
						r: msg.classeursUpdated
					};
					getPublicFoldersMetadata();
				}
				if (msg.settings) {
					syncData = clSyncDataSvc.userData.settings || {};
					if (syncData.s !== msg.settingsUpdated) {
						clSettingSvc.values = msg.settings;
						clSettingSvc.write(msg.settingsUpdated);
						apply = true;
					}
					clSyncDataSvc.userData.settings = {
						r: msg.settingsUpdated
					};
				}
				apply && $rootScope.$evalAsync();
				sendChanges();
				clSyncDataSvc.write();
			});

			function sendChanges() {
				var syncData, msg = {
					type: 'setUserData'
				};
				syncData = clSyncDataSvc.userData.user || {};
				if (clUserSvc.updated !== syncData.r) {
					msg.user = clUserSvc.user;
					msg.userUpdated = clUserSvc.updated;
					syncData.s = clUserSvc.updated;
					clSyncDataSvc.userData.user = syncData;
				}
				syncData = clSyncDataSvc.userData.classeurs || {};
				if (clClasseurSvc.updated !== syncData.r) {
					msg.classeurs = clClasseurSvc.classeurs.map(function(classeurDao) {
						return classeurDao.toStorable();
					});
					msg.classeursUpdated = clClasseurSvc.updated;
					syncData.s = clClasseurSvc.updated;
					clSyncDataSvc.userData.classeurs = syncData;
				}
				syncData = clSyncDataSvc.userData.settings || {};
				if (clSettingSvc.updated !== syncData.r) {
					msg.settings = clSettingSvc.values;
					msg.settingsUpdated = clSettingSvc.updated;
					syncData.s = clSettingSvc.updated;
					clSyncDataSvc.userData.settings = syncData;
				}
				Object.keys(msg).length > 1 && clSocketSvc.sendMsg(msg);
			}

			return retrieveChanges;
		})();


		/******
		Folders
		******/

		function getPublicFoldersMetadata() {
			var foldersToRefresh = clFolderSvc.folders.filter(function(folderDao) {
				return folderDao.isPublic && !folderDao.name;
			});
			if (!foldersToRefresh.length ||
				$window.navigator.onLine === false
			) {
				return;
			}
			$http.get('/api/metadata/folders', {
					timeout: clSyncDataSvc.loadingTimeout,
					params: {
						id: foldersToRefresh.map(function(folderDao) {
							return folderDao.id;
						}).join(','),
					}
				})
				.success(function(res) {
					res.forEach(function(item) {
						var folderDao = clFolderSvc.folderMap[item.id];
						if (folderDao) {
							clSyncDataSvc.updatePublicFolderMetadata(folderDao, item);
						}
					});
				});
		}

		var syncFolders = (function() {

			function retrieveChanges() {
				clSocketSvc.sendMsg({
					type: 'getFolderChanges',
					nextSeq: clSyncDataSvc.nextFolderSeq
				});
			}

			clSocketSvc.addMsgHandler('folderChanges', function(msg, ctx) {
				if (clSyncDataSvc.read(ctx)) {
					return;
				}
				var apply = clFolderSvc.checkAll(true);
				var foldersToUpdate = [];
				(msg.changes || []).forEach(function(change) {
					var folderDao = clFolderSvc.folderMap[change.id];
					var syncData = clSyncDataSvc.folders[change.id] || {};
					if (
						(change.deleted && folderDao) ||
						(!change.deleted && !folderDao) ||
						(folderDao && folderDao.updated != change.updated && syncData.r !== change.updated && syncData.s !== change.updated)
					) {
						foldersToUpdate.push(change);
					}
					if (change.deleted) {
						delete clSyncDataSvc.folders[change.id];
					} else {
						clSyncDataSvc.folders[change.id] = {
							r: change.updated
						};
					}
				});
				if (foldersToUpdate.length) {
					clFolderSvc.updateUserFolders(foldersToUpdate);
					clFolderSvc.write();
					apply = true;
				}
				clSyncDataSvc.nextFolderSeq = msg.nextSeq;
				if (msg.hasMore) {
					retrieveChanges();
				} else {
					// Sync user's classeurs once all folders are synced
					syncUser();
					sendChanges();
				}
				clSyncDataSvc.write();
				apply && $rootScope.$evalAsync();
			});

			function checkChange(folderDao) {
				if (folderDao.name) {
					if (folderDao.name.length > nameMaxLength) {
						folderDao.name = folderDao.name.slice(0, nameMaxLength);
					} else {
						return folderDao.updated < Date.now() - sendMetadataAfter;
					}
				}
			}

			function sendChanges() {
				clFolderSvc.folders.forEach(function(folderDao) {
					var syncData = clSyncDataSvc.folders[folderDao.id] || {};
					if (folderDao.updated == syncData.r || !checkChange(folderDao) || (folderDao.isPublic && folderDao.sharing !== 'rw')) {
						return;
					}
					if (folderDao.sharing[0] === '-') {
						clSocketSvc.sendMsg({
							type: 'deleteFolder',
							id: folderDao.id
						});
					} else {
						clSocketSvc.sendMsg({
							type: 'setFolderMetadata',
							id: folderDao.id,
							name: folderDao.name,
							sharing: folderDao.sharing || undefined,
							updated: folderDao.updated,
							lastUpdated: syncData.r
						});
					}
					syncData.s = folderDao.updated;
					clSyncDataSvc.folders[folderDao.id] = syncData;
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
					nextSeq: clSyncDataSvc.nextFileSeq
				});
			}

			clSocketSvc.addMsgHandler('fileChanges', function(msg, ctx) {
				if (clSyncDataSvc.read(ctx)) {
					return;
				}
				var apply = clFileSvc.checkAll(true);
				var filesToUpdate = [];
				(msg.changes || []).forEach(function(change) {
					var fileDao = clFileSvc.fileMap[change.id];
					var syncData = clSyncDataSvc.files[change.id] || {};
					if (
						(change.deleted && fileDao && !fileDao.isPublic) ||
						(!change.deleted && !fileDao) ||
						(fileDao && fileDao.updated != change.updated && syncData.r !== change.updated && syncData.s !== change.updated)
					) {
						filesToUpdate.push(change);
					}
					if (change.deleted) {
						delete clSyncDataSvc.files[change.id];
					} else {
						clSyncDataSvc.files[change.id] = {
							r: change.updated
						};
					}
				});
				if (filesToUpdate.length) {
					clFileSvc.updateUserFiles(filesToUpdate);
					clFileSvc.write();
					apply = true;
				}
				clSyncDataSvc.nextFileSeq = msg.nextSeq;
				if (msg.hasMore) {
					retrieveChanges();
				} else {
					sendChanges();
				}
				clSyncDataSvc.write();
				apply && $rootScope.$evalAsync();
			});

			function checkChange(fileDao) {
				if (fileDao.name) {
					if (fileDao.name.length > nameMaxLength) {
						fileDao.name = fileDao.name.slice(0, nameMaxLength);
					} else {
						return fileDao.updated < Date.now() - sendMetadataAfter;
					}
				}
			}

			clSyncSvc.fileRecoveryDates = {};

			function sendChanges() {
				clFileSvc.files.forEach(function(fileDao) {
					var syncData = clSyncDataSvc.files[fileDao.id] || {};
					// The file has been created
					if (!syncData.r || fileDao.updated == syncData.r || !checkChange(fileDao) || (fileDao.isPublic && fileDao.sharing !== 'rw')) {
						return;
					}
					var deleted = fileDao.sharing[0] === '-' ? fileDao.updated : undefined;
					clSocketSvc.sendMsg({
						type: 'setFileMetadata',
						id: fileDao.id,
						name: fileDao.name,
						folderId: fileDao.folderId || undefined,
						sharing: (deleted ? fileDao.sharing.slice(1) : fileDao.sharing) || undefined,
						updated: fileDao.updated,
						deleted: deleted,
						lastUpdated: !deleted ? syncData.r : undefined
					});
					syncData.s = fileDao.updated;
					clSyncDataSvc.files[fileDao.id] = syncData;
				});
				clSyncDataSvc.fileSyncReady = '1';
			}

			clSyncSvc.recoverFile = function(file) {
				var currentDate = Date.now();
				clSyncSvc.fileRecoveryDates[file.id] = currentDate;
				if (!clFileSvc.fileMap.hasOwnProperty(file.id)) {
					clSocketSvc.sendMsg({
						type: 'setFileChange',
						id: file.id,
						name: file.name,
						folderId: file.folderId || undefined,
						sharing: file.sharing || undefined,
						updated: currentDate
					});
				}
			};

			return retrieveChanges;
		})();


		/********
		New files
		********/

		var fileCreationDates = {};
		var sendNewFiles = (function() {
			function sendNewFiles() {
				var currentDate = Date.now();
				Object.keys(fileCreationDates).forEach(function(fileId) {
					if (fileCreationDates[fileId] + createFileTimeout < currentDate) {
						delete fileCreationDates[fileId];
					}
				});
				clFileSvc.files.filter(function(fileDao) {
					return clSyncDataSvc.isFilePendingCreation(fileDao) && !fileCreationDates.hasOwnProperty(fileDao.id);
				}).forEach(function(fileDao) {
					fileCreationDates[fileDao.id] = currentDate;
					fileDao.loadExecUnload(function() {
						clSocketSvc.sendMsg({
							type: 'createFile',
							id: fileDao.id,
							folderId: fileDao.folderId,
							txt: fileDao.contentDao.txt || '\n',
							properties: fileDao.contentDao.properties || {}
						});
					});
				});
			}

			clSocketSvc.addMsgHandler('createdFile', function(msg, ctx) {
				if (clSyncDataSvc.read(ctx)) {
					return;
				}
				delete fileCreationDates[msg.id];
				var fileDao = clFileSvc.fileMap[msg.id];
				if (!fileDao) {
					return;
				}
				fileDao.folderId = msg.folderId || '';
				fileDao.isPublic = msg.isPublic ? '1' : '';
				clSyncDataSvc.files[msg.id] = {
					r: -1
				};
				msg.rev && clContentRevSvc.setRev(msg.id, msg.rev);
				clSyncDataSvc.write();
			});

			return sendNewFiles;
		})();

		clSyncSvc.saveAll = function() {
			return clUserSvc.checkAll() |
				clFileSvc.checkAll() |
				clFolderSvc.checkAll() |
				clClasseurSvc.checkAll() |
				clSettingSvc.checkAll() |
				clLocalSettingSvc.checkAll();
		};

		clSetInterval(function() {
			clSyncDataSvc.read(clSocketSvc.ctx);

			// Need to save here to have the `updated` attributes up to date
			clSyncSvc.saveAll() && $rootScope.$apply();

			var currentDate = Date.now();
			Object.keys(clSyncSvc.fileRecoveryDates).forEach(function(fileId) {
				if (clSyncSvc.fileRecoveryDates[fileId] + recoverFileTimeout < currentDate) {
					delete clSyncSvc.fileRecoveryDates[fileId];
				}
			});

			if (!clUserActivity.isActive() || !clSocketSvc.isOnline()) {
				return;
			}
			if (Date.now() - clSyncDataSvc.lastActivity > maxSyncInactivity) {
				// Retrieve and send files/folders modifications
				syncFolders();
				syncFiles();
				clSyncDataSvc.write();
			}

			// Send new files
			if (clSyncDataSvc.fileSyncReady) {
				sendNewFiles();
			}
		}, 1100);

		return clSyncSvc;
	})
	.factory('clPublicSyncSvc', function($window, $http, clSyncDataSvc, clFileSvc, clFolderSvc, clToast) {
		var publicFileRefreshAfter = 60 * 1000; // 60 sec
		var lastGetExtFileAttempt = 0;

		function getLocalFiles() {
			var currentDate = Date.now();
			var filesToRefresh = clFileSvc.localFiles.filter(function(fileDao) {
				return fileDao.isPublic && (!fileDao.refreshed || currentDate - publicFileRefreshAfter > fileDao.refreshed);
			});
			if (!filesToRefresh.length ||
				currentDate - lastGetExtFileAttempt < publicFileRefreshAfter
			) {
				return;
			}
			lastGetExtFileAttempt = currentDate;
			$http.get('/api/metadata/files', {
					timeout: clSyncDataSvc.loadingTimeout,
					params: {
						id: filesToRefresh.map(function(fileDao) {
							return fileDao.id;
						}).join(',')
					}
				})
				.success(function(res) {
					lastGetExtFileAttempt = 0;
					res.forEach(function(item) {
						var fileDao = clFileSvc.fileMap[item.id];
						if (fileDao) {
							clSyncDataSvc.updatePublicFileMetadata(fileDao, item);
							item.updated || clToast('File is not accessible: ' + fileDao.name);
						}
					});
				});
		}

		function getPublicFolder(folderDao) {
			if (!folderDao || !folderDao.isPublic ||
				(folderDao.lastRefresh && Date.now() - folderDao.lastRefresh < publicFileRefreshAfter)
			) {
				return;
			}
			$http.get('/api/folders/' + folderDao.id, {
					timeout: clSyncDataSvc.loadingTimeout
				})
				.success(function(res) {
					var currentDate = Date.now();
					clSyncDataSvc.publicFolders[folderDao.id] = currentDate;
					folderDao.lastRefresh = currentDate;
					clSyncDataSvc.updatePublicFolderMetadata(folderDao, res);
					var filesToMove = {};
					clFileSvc.files.forEach(function(fileDao) {
						if (fileDao.folderId === folderDao.id) {
							filesToMove[fileDao.id] = fileDao;
						}
					});
					res.files.forEach(function(item) {
						delete filesToMove[item.id];
						var fileDao = clFileSvc.fileMap[item.id];
						if (!fileDao) {
							fileDao = clFileSvc.createPublicFile(item.id);
							clFileSvc.fileMap[fileDao.id] = fileDao;
							clFileSvc.fileIds.push(fileDao.id);
						}
						fileDao.folderId = folderDao.id;
						clSyncDataSvc.updatePublicFileMetadata(fileDao, item);
					});
					angular.forEach(filesToMove, function(fileDao) {
						fileDao.folderId = '';
					});
					clFileSvc.init();
				})
				.error(function() {
					folderDao.lastRefresh = 1; // Get rid of the spinner
					clToast('Folder is not accessible.');
					!folderDao.name && clFolderSvc.removeFolder(folderDao);
				});
		}

		return {
			getFolder: function(folderDao) {
				if ($window.navigator.onLine !== false) {
					folderDao ? getPublicFolder(folderDao) : getLocalFiles();
				}
			}
		};
	})
	.factory('clContentSyncSvc', function($window, $rootScope, $timeout, $http, clSetInterval, clSocketSvc, clUserActivity, clSyncDataSvc, clFileSvc, clToast, clSyncUtils, clEditorSvc, clContentRevSvc, clUserInfoSvc) {
		var clContentSyncSvc = {};
		var watchCtx;

		function setWatchCtx(ctx) {
			watchCtx = ctx;
			clContentSyncSvc.watchCtx = ctx;
		}
		var unsetWatchCtx = setWatchCtx.bind(undefined, undefined);
		clSocketSvc.addMsgHandler('userToken', unsetWatchCtx);

		function setLoadedContent(fileDao, serverContent) {
			fileDao.contentDao.txt = serverContent.txt;
			fileDao.contentDao.properties = serverContent.properties;
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

		function getServerContent(content, contentChanges) {
			return {
				txt: contentChanges.reduce(function(serverTxt, contentChange) {
					return clSyncUtils.applyTxtPatches(serverTxt, contentChange.txt || []);
				}, content.txt),
				properties: contentChanges.reduce(function(serverProperties, contentChange) {
					return clSyncUtils.applyPropertiesPatches(serverProperties, contentChange.properties || []);
				}, content.properties),
				rev: content.rev + contentChanges.length
			};
		}

		function applyServerContent(fileDao, oldContent, serverContent) {
			var oldTxt = oldContent.txt;
			var serverTxt = serverContent.txt;
			var localTxt = clEditorSvc.cledit.getContent();
			var isServerTxtChanges = oldTxt !== serverTxt;
			var isLocalTxtChanges = oldTxt !== localTxt;
			var isTxtSynchronized = serverTxt === localTxt;
			if (!isTxtSynchronized && isServerTxtChanges && isLocalTxtChanges) {
				// TODO Deal with conflict
				clEditorSvc.setContent(serverTxt, true);
			} else if (!isTxtSynchronized && isServerTxtChanges) {
				clEditorSvc.setContent(serverTxt, true);
			}
			var valueHash = {},
				valueArray = [];
			// Hash local object first to preserve Angular indexes
			var localPropertiesHash = clSyncUtils.hashObject(fileDao.contentDao.properties, valueHash, valueArray);
			var oldPropertiesHash = clSyncUtils.hashObject(oldContent.properties, valueHash, valueArray);
			var serverPropertiesHash = clSyncUtils.hashObject(serverContent.properties, valueHash, valueArray);
			if (oldPropertiesHash !== localPropertiesHash) {
				localPropertiesHash = clSyncUtils.quickPatch(oldPropertiesHash, serverPropertiesHash, localPropertiesHash);
				fileDao.contentDao.properties = clSyncUtils.unhashObject(localPropertiesHash, valueArray);
			} else {
				fileDao.contentDao.properties = serverContent.properties;
			}
		}

		function startWatchFile(fileDao) {
			if (!fileDao || !fileDao.state || fileDao.isReadOnly || clSyncDataSvc.isFilePendingCreation(fileDao) || (watchCtx && fileDao === watchCtx.fileDao)) {
				return;
			}
			fileDao.loadPending = false;
			setWatchCtx({
				fileDao: fileDao,
				rev: clContentRevSvc.getRev(fileDao.id),
				userActivities: {},
				contentChanges: []
			});
			clSocketSvc.sendMsg({
				type: 'startWatchFile',
				id: fileDao.id,
				from: watchCtx.rev
			});
			$timeout.cancel(fileDao.loadingTimeoutId);
			fileDao.loadingTimeoutId = $timeout(function() {
				setLoadingError(fileDao, 'Loading timeout.');
			}, clSyncDataSvc.loadingTimeout);
		}

		function stopWatchFile() {
			if (watchCtx && watchCtx.fileDao) {
				clSocketSvc.sendMsg({
					type: 'stopWatchFile'
				});
				unsetWatchCtx();
			}
		}

		clSocketSvc.addMsgHandler('watchFile', function(msg) {
			if (!watchCtx || !watchCtx.fileDao.state || watchCtx.fileDao.id !== msg.id) {
				return;
			}
			var fileDao = watchCtx.fileDao;
			$timeout.cancel(fileDao.loadingTimeoutId);
			if (msg.error) {
				return setLoadingError(fileDao);
			}
			fileDao.isPublic && clSyncDataSvc.updatePublicFileMetadata(fileDao, msg);
			var apply, serverContent = getServerContent(msg.content, msg.contentChanges || []);
			if (fileDao.state === 'loading') {
				setLoadedContent(fileDao, serverContent);
				apply = true;
			} else {
				applyServerContent(fileDao, msg.content, serverContent);
			}
			watchCtx.txt = serverContent.txt;
			watchCtx.properties = serverContent.properties;
			watchCtx.rev = serverContent.rev;
			clContentRevSvc.setRev(fileDao.id, serverContent.rev);
			// Evaluate scope synchronously to have cledit instantiated
			apply && $rootScope.$apply();
		});

		function getPublicFile(fileDao) {
			if (!fileDao || !fileDao.state || !fileDao.loadPending || !fileDao.isPublic || $window.navigator.onLine === false) {
				return;
			}
			fileDao.loadPending = false;
			var fromRev = clContentRevSvc.getRev(fileDao.id);
			$http.get('/api/files/' + fileDao.id + (fromRev ? '/from/' + fromRev : ''), {
					timeout: clSyncDataSvc.loadingTimeout
				})
				.success(function(res) {
					clSyncDataSvc.updatePublicFileMetadata(fileDao, res);
					if (!fileDao.state) {
						return;
					}
					var serverContent = getServerContent(res.content, res.contentChanges || []);
					if (fileDao.state === 'loading') {
						setLoadedContent(fileDao, serverContent);
					} else {
						applyServerContent(fileDao, res.content, serverContent);
					}
					clContentRevSvc.setRev(fileDao.id, serverContent.rev);
				})
				.error(function() {
					setLoadingError(fileDao);
				});
		}

		function sendContentChange() {
			if (!watchCtx || watchCtx.txt === undefined || watchCtx.sentMsg) {
				return;
			}
			// if(watchCtx.fileDao.isPublic && (watchCtx.fileDao.sharing !== 'rw' || clUserSvc.user.plan !== 'premium')) {
			if (watchCtx.fileDao.isPublic && watchCtx.fileDao.sharing !== 'rw') {
				return;
			}
			var txtChanges = clSyncUtils.getTxtPatches(watchCtx.txt, clEditorSvc.cledit.getContent());
			txtChanges = txtChanges.length ? txtChanges : undefined;
			var propertiesChanges = clSyncUtils.getPropertiesPatches(watchCtx.properties, watchCtx.fileDao.contentDao.properties);
			propertiesChanges = propertiesChanges.length ? propertiesChanges : undefined;
			if (!txtChanges && !propertiesChanges) {
				return;
			}
			var newRev = watchCtx.rev + 1;
			watchCtx.sentMsg = {
				type: 'setContentChange',
				rev: newRev,
				txt: txtChanges,
				properties: propertiesChanges
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
			var serverProperties = watchCtx.properties;
			while ((msg = watchCtx.contentChanges[watchCtx.rev + 1])) {
				watchCtx.rev = msg.rev;
				watchCtx.contentChanges[msg.rev] = undefined;
				if (!msg.userId && watchCtx.sentMsg && msg.rev === watchCtx.sentMsg.rev) {
					// This has to be the previously sent message
					msg = watchCtx.sentMsg;
				}
				var oldTxt = serverTxt;
				serverTxt = clSyncUtils.applyTxtPatches(serverTxt, msg.txt || []);
				serverProperties = clSyncUtils.applyPropertiesPatches(serverProperties, msg.properties || []);
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
						var offset = clEditorSvc.setContent(localTxt, true);
						var userActivity = watchCtx.userActivities[msg.userId] || {};
						userActivity.offset = offset;
						watchCtx.userActivities[msg.userId] = userActivity;
					}
					clUserInfoSvc.request(msg.userId);
				}
				watchCtx.sentMsg = undefined;
			}
			var valueHash = {},
				valueArray = [];
			// Hash local object first to preserve Angular indexes
			var localPropertiesHash = clSyncUtils.hashObject(watchCtx.fileDao.contentDao.properties, valueHash, valueArray);
			var oldPropertiesHash = clSyncUtils.hashObject(watchCtx.properties, valueHash, valueArray);
			var serverPropertiesHash = clSyncUtils.hashObject(serverProperties, valueHash, valueArray);
			var isServerPropertiesChanges = oldPropertiesHash !== serverPropertiesHash;
			var isLocalPropertiesChanges = oldPropertiesHash !== localPropertiesHash;
			var isPropertiesSynchronized = serverPropertiesHash === localPropertiesHash;
			if (!isPropertiesSynchronized && isServerPropertiesChanges) {
				if (isLocalPropertiesChanges) {
					localPropertiesHash = clSyncUtils.quickPatch(oldPropertiesHash, serverPropertiesHash, localPropertiesHash);
				} else {
					localPropertiesHash = serverPropertiesHash;
				}
				watchCtx.fileDao.contentDao.properties = clSyncUtils.unhashObject(localPropertiesHash, valueArray);
			}
			watchCtx.txt = serverTxt;
			watchCtx.properties = serverProperties;
			clContentRevSvc.setRev(watchCtx.fileDao.id, watchCtx.rev);
		});

		$rootScope.$watch('currentFileDao', function(currentFileDao) {
			if (currentFileDao) {
				currentFileDao.loadPending = true;
			}
			if (clSocketSvc.isOnline()) {
				clSyncDataSvc.read(clSocketSvc.ctx);
				stopWatchFile();
				startWatchFile(currentFileDao);
			} else if (!clSocketSvc.hasToken) {
				getPublicFile(currentFileDao);
			}
		});

		clSetInterval(function() {
			if (!clUserActivity.isActive()) {
				return;
			}
			var currentFileDao = $rootScope.currentFileDao;
			if (clSocketSvc.isOnline()) {
				if (clSyncDataSvc.read(clSocketSvc.ctx)) {
					stopWatchFile();
				}
				startWatchFile(currentFileDao);
				sendContentChange();
			} else if (!clSocketSvc.hasToken) {
				getPublicFile(currentFileDao);
			}
		}, 200);

		return clContentSyncSvc;
	})
	.factory('clSyncUtils', function($window) {
		var diffMatchPatch = new $window.diff_match_patch();
		var DIFF_DELETE = -1;
		var DIFF_INSERT = 1;
		var DIFF_EQUAL = 0;

		function getTxtPatches(oldTxt, newTxt) {
			var diffs = diffMatchPatch.diff_main(oldTxt, newTxt);
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
							o: startOffset,
							d: changeText
						});
						break;
					case DIFF_INSERT:
						patches.push({
							o: startOffset,
							a: changeText
						});
						startOffset += changeText.length;
						break;
				}
			});
			return patches;
		}

		function getPropertiesPatches(oldProperties, newProperties) {
			var valueHash = {},
				valueArray = [];
			oldProperties = hashObject(oldProperties, valueHash, valueArray);
			newProperties = hashObject(newProperties, valueHash, valueArray);
			var diffs = diffMatchPatch.diff_main(oldProperties, newProperties);
			var patches = [];
			diffs.forEach(function(change) {
				var changeType = change[0];
				var changeHash = change[1];
				if (changeType === DIFF_EQUAL) {
					return;
				}
				changeHash.split('').forEach(function(objHash) {
					var obj = valueArray[objHash.charCodeAt(0)];
					var patch = {
						k: obj[0]
					};
					patch[changeType === DIFF_DELETE ? 'd' : 'a'] = obj[1];
					patches.push(patch);
				});
			});
			return patches;
		}

		function applyTxtPatches(txt, patches) {
			return patches.reduce(function(txt, patch) {
				if (patch.a) {
					return txt.slice(0, patch.o) + patch.a + txt.slice(patch.o);
				} else if (patch.d) {
					return txt.slice(0, patch.o) + txt.slice(patch.o + patch.d.length);
				} else {
					return txt;
				}
			}, txt);
		}

		function applyPropertiesPatches(properties, patches) {
			var result = angular.extend({}, properties);
			patches.forEach(function(patch) {
				if (patch.a) {
					result[patch.k] = patch.a;
				} else if (patch.d) {
					delete result[patch.k];
				}
			});
			return result;
		}

		function quickPatch(oldStr, newStr, destStr) {
			var diffs = diffMatchPatch.diff_main(oldStr, newStr);
			var patches = diffMatchPatch.patch_make(oldStr, diffs);
			var patchResult = diffMatchPatch.patch_apply(patches, destStr);
			return patchResult[0];
		}

		function hashArray(arr, valueHash, valueArray) {
			var hash = [];
			arr.forEach(function(obj) {
				var serializedObj = JSON.stringify(obj);
				var objHash;
				if (!valueHash.hasOwnProperty(serializedObj)) {
					objHash = valueArray.length;
					valueArray.push(obj);
					valueHash[serializedObj] = objHash;
				} else {
					objHash = valueHash[serializedObj];
				}
				hash.push(objHash);
			});
			return String.fromCharCode.apply(null, hash);
		}

		function unhashArray(hash, valueArray) {
			return hash.split('').map(function(objHash) {
				return valueArray[objHash.charCodeAt(0)];
			});
		}

		function hashObject(obj, valueHash, valueArray) {
			return hashArray(Object.keys(obj || {}).sort().map(function(key) {
				return [key, obj[key]];
			}), valueHash, valueArray);
		}

		function unhashObject(hash, valueArray) {
			var result = {};
			unhashArray(hash, valueArray).forEach(function(value) {
				result[value[0]] = value[1];
			});
			return result;
		}

		return {
			getTxtPatches: getTxtPatches,
			getPropertiesPatches: getPropertiesPatches,
			applyTxtPatches: applyTxtPatches,
			applyPropertiesPatches: applyPropertiesPatches,
			quickPatch: quickPatch,
			hashArray: hashArray,
			unhashArray: unhashArray,
			hashObject: hashObject,
			unhashObject: unhashObject,
		};
	});
