angular.module('classeur.opt.readOnlyAlert', [])
	.directive('clReadOnlyAlert', function(clEditorLayoutSvc, clSyncSvc, clUserSvc, clSocketSvc, clEditorSvc) {
		return {
			restrict: 'E',
			scope: true,
			template: '<cl-read-only-alert-panel ng-if="editorLayoutSvc.currentControl === \'readOnlyAlert\'"></cl-read-only-alert-panel><cl-write-premium-alert-panel ng-if="editorLayoutSvc.currentControl === \'writePremiumAlert\'"></cl-write-premium-alert-panel>',
			link: function(scope) {
				var wasDismissed;

				scope.dismiss = function() {
					wasDismissed = true;
					clEditorLayoutSvc.currentControl = undefined;
				};

				var text;
				if (scope.currentFileDao.isReadOnly || scope.currentFileDao.isPublic) {
					scope.$watch('currentFileDao.contentDao.text', function(newtext) {
						if (text === undefined || !scope.currentFileDao) {
							text = newtext;
							return;
						}
						if (wasDismissed) {
							return;
						}
						if(clEditorSvc.lastContentChange - clEditorSvc.lastExternalChange < 1500) {
							return;
						}
						if (scope.currentFileDao.isReadOnly || scope.currentFileDao.sharing !== 'rw') {
							clEditorLayoutSvc.currentControl = 'readOnlyAlert';
							return;
						}
						// if(!clSocketSvc.hasToken || clUserSvc.user.plan !== 'premium') {
						if(!clSocketSvc.hasToken) {
							clEditorLayoutSvc.currentControl = 'writePremiumAlert';
							return;
						}
					});
				}
			}
		};
	})
	.directive('clReadOnlyAlertPanel', function(clDraggablePanel) {
		return {
			restrict: 'E',
			templateUrl: 'opt/readOnlyAlert/readOnlyAlertPanel.html',
			link: function(scope, element) {
				clDraggablePanel(element, '.read-only-alert.panel', 0, 0, -1);
			}
		};
	})
	.directive('clWritePremiumAlertPanel', function(clDraggablePanel) {
		return {
			restrict: 'E',
			templateUrl: 'opt/readOnlyAlert/writePremiumAlertPanel.html',
			link: function(scope, element) {
				clDraggablePanel(element, '.write-premium-alert.panel', 0, 0, -1);
			}
		};
	});
