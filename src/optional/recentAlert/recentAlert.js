angular.module('classeur.optional.recentAlert', [])
	.directive('clRecentAlert',
		function(clLocalStorage) {
			var dismissFlagKey = 'recentDismiss';
			var dismissFlag = clLocalStorage.hasOwnProperty(dismissFlagKey);
			return {
				restrict: 'E',
				template: '<cl-recent-alert-panel ng-if="show"></cl-recent-alert-panel>',
				scope: true,
				link: link
			};

			function link(scope) {
				scope.show = !dismissFlag;
				scope.dismiss = function() {
					clLocalStorage[dismissFlagKey] = 1;
					dismissFlag = true;
					scope.show = false;
				};
			}
		})
	.directive('clRecentAlertPanel',
		function(clPanel) {
			return {
				restrict: 'E',
				templateUrl: 'optional/recentAlert/recentAlertPanel.html',
				link: link
			};

			function link(scope, element) {
				clPanel(element, '.recent-alert.panel').move().rotate(-1).end();
			}
		});
