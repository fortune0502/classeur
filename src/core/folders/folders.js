angular.module('classeur.core.folders', [])
  .directive('clFolderName',
    function ($timeout, clExplorerLayoutSvc) {
      return {
        restrict: 'E',
        templateUrl: 'core/folders/folderName.html',
        link: link
      }

      function link (scope, element) {
        var nameInputElt = element[0].querySelector('.folder-name__input')
        nameInputElt.addEventListener('keydown', function (e) {
          if (e.which === 27) {
            scope.form.$rollbackViewValue()
            nameInputElt.blur()
          } else if (e.which === 13) {
            nameInputElt.blur()
          }
        })
        scope.name = function (name) {
          if (name) {
            clExplorerLayoutSvc.currentFolderDao.name = name
          } else if (!clExplorerLayoutSvc.currentFolderDao.name) {
            clExplorerLayoutSvc.currentFolderDao.name = 'Untitled'
          }
          return clExplorerLayoutSvc.currentFolderDao.name
        }
        scope.name()
        var unsetTimeout
        scope.setEditing = function (value) {
          $timeout.cancel(unsetTimeout)
          if (value) {
            scope.isEditing = true
            setTimeout(function () {
              nameInputElt.focus()
            }, 10)
          } else {
            unsetTimeout = $timeout(function () {
              scope.isEditing = false
              scope.folderNameModified()
            }, 250)
          }
        }
      }
    })
  .factory('clFolderSvc',
    function (clLocalStorage, clUid, clLocalStorageObject) {
      var folderDaoProto = clLocalStorageObject('F', {
        name: 'string',
        sharing: 'string',
        userId: 'string',
        deleted: 'int'
      }, true)

      function FolderDao (id) {
        this.id = id
        this.$setId(id)
        this.read()
      }

      FolderDao.prototype = folderDaoProto

      FolderDao.prototype.read = function () {
        this.$read()
        this.$readUpdate()
      }

      FolderDao.prototype.write = function (updated) {
        this.$write()
        this.extUpdated = undefined
      }

      var clFolderSvc = clLocalStorageObject('folderSvc', {
        folderIds: 'array',
        foldersToRemove: 'array'
      })

      var authorizedKeys = {
        u: true,
        userId: true,
        name: true,
        sharing: true,
        deleted: true
      }

      var isInitialized

      function init () {
        if (!clFolderSvc.folderIds) {
          clFolderSvc.$read()
        }

        var folderMap = Object.create(null)
        var deletedFolderMap = Object.create(null)
        clFolderSvc.folderIds = clFolderSvc.folderIds.cl_filter(function (id) {
          var folderDao = clFolderSvc.folderMap[id] || clFolderSvc.deletedFolderMap[id] || new FolderDao(id)
          if (!folderDao.deleted && !folderMap[id]) {
            folderMap[id] = folderDao
            return true
          }
          if (folderDao.deleted && !deletedFolderMap[id]) {
            deletedFolderMap[id] = folderDao
            return true
          }
        })
        clFolderSvc.folderMap = folderMap
        clFolderSvc.deletedFolderMap = deletedFolderMap

        clFolderSvc.folders = Object.keys(folderMap).cl_map(function (id) {
          return folderMap[id]
        })
        clFolderSvc.deletedFolders = Object.keys(deletedFolderMap).cl_map(function (id) {
          return deletedFolderMap[id]
        })

        if (!isInitialized) {
          var keyPrefix = /^F\.(\w+)\.(\w+)/
          Object.keys(clLocalStorage).cl_each(function (key) {
            if (key.charCodeAt(0) === 0x46 /* F */) {
              var match = key.match(keyPrefix)
              if (match) {
                if ((!clFolderSvc.folderMap[match[1]] && !clFolderSvc.deletedFolderMap[match[1]]) ||
                  !authorizedKeys.hasOwnProperty(match[2])) {
                  clLocalStorage.removeItem(key)
                }
              }
            }
          })
          isInitialized = true
        }
      }

      function checkLocalStorage () {
        // Check folder id list
        var checkFolderSvcUpdate = clFolderSvc.$checkUpdate()
        clFolderSvc.$readUpdate()
        if (checkFolderSvcUpdate && clFolderSvc.$check()) {
          clFolderSvc.folderIds = undefined
        } else {
          clFolderSvc.$write()
        }

        // Check every folder
        var checkFolderUpdate = folderDaoProto.$checkGlobalUpdate()
        folderDaoProto.$readGlobalUpdate()
        clFolderSvc.folders.concat(clFolderSvc.deletedFolders).cl_each(function (folderDao) {
          if (checkFolderUpdate && folderDao.$checkUpdate()) {
            folderDao.read()
          } else {
            folderDao.write()
          }
        })

        if (checkFolderSvcUpdate || checkFolderUpdate) {
          init()
          return true
        }
      }

      function createFolder (id) {
        id = id || clUid()
        var folderDao = clFolderSvc.deletedFolderMap[id] || new FolderDao(id)
        folderDao.deleted = 0
        clFolderSvc.folderIds.push(id)
        clFolderSvc.folderMap[id] = folderDao
        init()
        return folderDao
      }

      function createPublicFolder (id) {
        var folderDao = createFolder(id)
        folderDao.userId = folderDao.userId || '0' // Will be filled by the sync module
        return folderDao
      }

      // Remove folderDao from folders and deletedFolders
      function removeFolders (folderDaoList) {
        if (!folderDaoList.length) {
          return
        }

        // Create hash for fast filter
        var folderIds = folderDaoList.cl_reduce(function (folderIds, folderDao) {
          folderIds[folderDao.id] = 1
          return folderIds
        }, Object.create(null))

        // Filter
        clFolderSvc.folderIds = clFolderSvc.folderIds.cl_filter(function (folderId) {
          return !folderIds[folderId]
        })
        init()
      }

      function setDeletedFolders (folderDaoList) {
        if (!folderDaoList.length) {
          return
        }
        var currentDate = Date.now()
        folderDaoList.cl_each(function (folderDao) {
          folderDao.deleted = currentDate
        })
        init()
      }

      function setDeletedFolder (folderDao) {
        var index = clFolderSvc.folders.indexOf(folderDao)
        if (index !== -1) {
          setDeletedFolders([folderDao])
        }
        return index
      }

      function updateUserFolders (changes) {
        changes.cl_each(function (change) {
          var folderDao = clFolderSvc.folderMap[change.id]
          if (change.deleted && folderDao) {
            var index = clFolderSvc.folders.indexOf(folderDao)
            clFolderSvc.folderIds.splice(index, 1)
          } else if (!change.deleted && !folderDao) {
            folderDao = new FolderDao(change.id)
            clFolderSvc.folderMap[change.id] = folderDao
            clFolderSvc.folderIds.push(change.id)
          }
          folderDao.name = change.name || ''
          folderDao.sharing = change.sharing || ''
          folderDao.userId = ''
          folderDao.$setExtUpdate(change.updated)
        })
        init()
      }

      clFolderSvc.FolderDao = FolderDao
      clFolderSvc.init = init
      clFolderSvc.checkLocalStorage = checkLocalStorage
      clFolderSvc.createFolder = createFolder
      clFolderSvc.createPublicFolder = createPublicFolder
      clFolderSvc.removeFolders = removeFolders
      clFolderSvc.setDeletedFolders = setDeletedFolders
      clFolderSvc.setDeletedFolder = setDeletedFolder
      clFolderSvc.updateUserFolders = updateUserFolders
      clFolderSvc.folders = []
      clFolderSvc.deletedFolders = []
      clFolderSvc.folderMap = Object.create(null)
      clFolderSvc.deletedFolderMap = Object.create(null)

      init()
      return clFolderSvc
    })
