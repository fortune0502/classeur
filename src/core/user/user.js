angular.module('classeur.core.user', [])
  .config(
    function ($routeProvider) {
      $routeProvider.when('/newUser', {
        template: '<cl-new-user-form></cl-new-user-form>'
      })
      $routeProvider.when('/signin', {
        template: '<cl-signin-form></cl-signin-form>'
      })
    })
  .factory('clUserActivity',
    function ($window, $rootScope, clLocalStorage) {
      var inactiveAfter = 2 * 60 * 1000 // 2 minutes
      var lastActivity
      var lastFocus
      var lastFocusKey = 'lastWindowFocus'
      var clUserActivity = {
        inactiveAfter: inactiveAfter
      }

      function setLastActivity () {
        lastActivity = Date.now()
      }

      function setLastFocus () {
        lastFocus = Date.now()
        clLocalStorage[lastFocusKey] = lastFocus
        setLastActivity()
      }

      clUserActivity.checkActivity = function () {
        var isActive = lastActivity > Date.now() - inactiveAfter && parseInt(clLocalStorage[lastFocusKey], 10) === lastFocus
        if (isActive !== clUserActivity.isActive) {
          clUserActivity.isActive = isActive
          $rootScope.$evalAsync()
        }
        return isActive
      }

      setLastFocus()
      $window.addEventListener('focus', setLastFocus)
      $window.document.addEventListener('mousedown', setLastActivity)
      $window.document.addEventListener('keydown', setLastActivity)
      return clUserActivity
    })
  .factory('clUserSvc',
    function ($window, $rootScope, $location, clSocketSvc, clConfig, clStateMgr) {
      var clUserSvc = {
        signin: signin,
        signout: signout,
        getSubscribeLink: getSubscribeLink,
        getUnsubscribeLink: getUnsubscribeLink,
        isUserPremium: isUserPremium
      }
      if (!clConfig.loginForm) {
        clUserSvc.startOAuth = startOAuth
      }

      function makeQueryString (params) {
        return params.cl_map(function (value, key) {
          return key + '=' + encodeURIComponent(value)
        }).join('&')
      }

      function startOAuth (redirectUrl) {
        var params = {
          client_id: clConfig.googleClientId,
          response_type: 'code',
          redirect_uri: clConfig.appUri + '/oauth/google/callback',
          scope: 'profile',
          state: clStateMgr.saveState({
            url: redirectUrl || '/newUser'
          })
        }
        if (clConfig.googleAppsDomain) {
          params.scope = 'openid email'
          params.hd = clConfig.googleAppsDomain
        }
        $window.location.href = 'https://accounts.google.com/o/oauth2/auth?' + makeQueryString(params)
      }

      function signin (token) {
        clSocketSvc.setToken(token)
        clSocketSvc.openSocket()
      }

      function signout () {
        clSocketSvc.clearToken()
        clSocketSvc.closeSocket()
        clUserSvc.user = null
      }

      function isUserPremium () {
        return this.user && this.user.roles && ~this.user.roles.indexOf('premium_user')
      }

      function getSubscribeLink () {
        if (clUserSvc.user) {
          var params = {
            cmd: '_s-xclick',
            hosted_button_id: clConfig.paypalSubscribeButtonId,
            custom: clUserSvc.user.id
          }
          return clConfig.paypalUri + '?' + makeQueryString(params)
        }
      }

      function getUnsubscribeLink () {
        var params = {
          cmd: '_subscr-find',
          alias: clConfig.paypalUnsubscribeButtonAlias
        }
        return clConfig.paypalUri + '?' + makeQueryString(params)
      }

      clSocketSvc.addMsgHandler('invalidToken', function () {
        signout()
        $rootScope.$evalAsync()
      })

      return clUserSvc
    })
  .factory('clUserInfoSvc',
    function ($window, $rootScope, $http, clUserSvc, clSocketSvc, clSetInterval, clIsNavigatorOnline, clHash) {
      var colors = [
        'ff5757',
        'e35d9c',
        '7d5af4',
        '5772e3',
        '57abab',
        '57c78f',
        '57ce68',
        '56ae72',
        '73ae74',
        '8fbe6d',
        'ffc758',
        'ffab58',
        'ff8f57',
        'ff7457'
      ]
      var requestedUserInfo = {}
      var userInfoTimeout = 30 * 1000 // 30 sec
      var lastUserInfoAttempt = 0

      var clUserInfoSvc = {
        users: Object.create(null),
        request: function (id) {
          if (id && !clUserInfoSvc.users[id]) {
            clUserInfoSvc.users[id] = {
              displayName: id === clUserSvc.user.id ? 'You' : 'Someone',
              color: colors[clHash(id) % colors.length],
              gravatarHash: '00000000000000000000000000000000'
            }
            requestedUserInfo[id] = true
            getUserInfos()
          }
        }
      }

      var getUserInfos = $window.cledit.Utils.debounce(function () {
        if (!clIsNavigatorOnline()) {
          return
        }
        var currentDate = Date.now()
        var ids = Object.keys(requestedUserInfo)
        if (!ids.length || currentDate - lastUserInfoAttempt < userInfoTimeout) {
          return
        }
        lastUserInfoAttempt = currentDate
        $http.get('/api/v1/metadata/users', {
          headers: clSocketSvc.makeAuthorizationHeader(),
          timeout: userInfoTimeout,
          params: {
            id: ids.join(',')
          }
        })
          .success(function (res) {
            lastUserInfoAttempt = 0
            res.cl_each(function (user) {
              clUserInfoSvc.users[user.id].cl_extend(user)
              delete requestedUserInfo[user.id]
            })
            buildNames()
          })
      })

      function buildNames () {
        Object.keys(clUserInfoSvc.users).cl_each(function (id) {
          var user = clUserInfoSvc.users[id]
          user.displayName = id === clUserSvc.user.id ? 'You' : user.name || 'Someone'
        })
        clUserInfoSvc.lastUserInfo = Date.now()
      }

      clSetInterval(getUserInfos, 1200)
      $rootScope.$watch('userSvc.user', buildNames)

      return clUserInfoSvc
    })
  .directive('clUserName',
    function (clUserInfoSvc) {
      return {
        restrict: 'E',
        scope: true,
        templateUrl: 'core/user/userName.html',
        link: function (scope, element, attrs) {
          scope.$watchGroup([attrs.userId, 'userInfoSvc.lastUserInfo'], function (newValues) {
            var userId = newValues[0]
            clUserInfoSvc.request(userId)
            scope.user = clUserInfoSvc.users[userId]
          })
          var imgElt = element[0].querySelector('img')
          imgElt.addEventListener('error', function () {
            imgElt.classList.add('user-name__img--hidden')
          })
          imgElt.addEventListener('load', function () {
            imgElt.classList.remove('user-name__img--hidden')
          })
        }
      }
    })
  .directive('clNewUserForm',
    function ($location, $http, clToast, clUserSvc, clStateMgr, clSyncSvc) {
      return {
        restrict: 'E',
        templateUrl: 'core/user/newUserForm.html',
        link: function (scope) {
          scope.close = function () {
            $location.url('')
          }

          if (!clStateMgr.state) {
            return scope.close()
          }

          var name = clStateMgr.state.$search.name
          var userToken = clStateMgr.state.$search.userToken
          var newUserToken = clStateMgr.state.$search.newUserToken
          if (!userToken && !newUserToken) {
            return scope.close()
          }

          if (userToken) {
            clUserSvc.signin(userToken)
            return scope.close()
          }

          scope.create = function () {
            if (!scope.newUser.name) {
              return clToast('Please enter a user name.')
            }
            if (scope.newUser.name.length > clSyncSvc.userNameMaxLength) {
              return clToast('User name is too long.')
            }
            scope.isLoading = true
            $http.post('/api/v1/users', {
              name: scope.newUser.name,
              token: newUserToken
            })
              .success(function (userToken) {
                clUserSvc.signin(userToken)
                $location.url('')
              })
              .error(function (data, status) {
                clToast(data.reason || 'Error: ' + status)
              })
          }

          scope.newUser = {
            name: name || ''
          }
        }
      }
    })
  .directive('clSigninForm',
    function ($location, $http, clToast, clUserSvc) {
      return {
        restrict: 'E',
        templateUrl: 'core/user/signinForm.html',
        link: function (scope) {
          scope.user = {}
          scope.close = function () {
            $location.url('')
          }
          scope.signin = function () {
            if (!scope.user.username) {
              return clToast('Please enter your login.')
            }
            if (!scope.user.password) {
              return clToast('Please enter your password.')
            }
            scope.isLoading = true
            $http.post('/api/v1/users', scope.user)
              .success(function (userToken) {
                clUserSvc.signin(userToken)
                $location.url('')
              })
              .error(function (data, status) {
                clToast(data.reason || 'Error: ' + status)
              })
          }
        }
      }
    })
