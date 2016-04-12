if (
  !window.Worker ||
  !window.MutationObserver ||
  !window.crypto // IE-11 not supported
) {
  window.alert('Unsupported browser version. Please upgrade your browser.')
} else {
  window.ES6Promise.polyfill()
  angular.module('classeur.app', [
    'ngRoute',
    'ngMaterial',
    'ngAnimate',
    'ngAria',
    'ngMessages',
    'angular-google-analytics',
    'classeur.templates',
    'classeur.blogs',
    'classeur.blogs.blogger',
    'classeur.blogs.github',
    'classeur.blogs.wordpress',
    'classeur.core',
    'classeur.core.analytics',
    'classeur.core.classeurs',
    'classeur.core.explorerLayout',
    'classeur.core.editor',
    'classeur.core.editor.editorContent',
    'classeur.core.editorLayout',
    'classeur.core.filePropertiesDialog',
    'classeur.core.files',
    'classeur.core.folders',
    'classeur.core.htmlSanitizer',
    'classeur.core.localDb',
    'classeur.core.pagedown',
    'classeur.core.settings',
    'classeur.core.sync',
    'classeur.core.sync.contentSync',
    'classeur.core.socket',
    'classeur.core.templateManagerDialog',
    'classeur.core.user',
    'classeur.core.utils',
    'classeur.optional.buttonBar',
    'classeur.optional.discussions',
    'classeur.optional.electron',
    'classeur.optional.exportToDisk',
    'classeur.optional.fileDragging',
    'classeur.optional.fileHistory',
    'classeur.optional.findReplace',
    'classeur.optional.folding',
    'classeur.optional.headingAnchor',
    'classeur.optional.helpDialog',
    'classeur.optional.keystrokes',
    'classeur.optional.markdownSample',
    'classeur.optional.offlineAlert',
    'classeur.optional.planChooser',
    'classeur.optional.postToBlog',
    'classeur.optional.quotaDialog',
    'classeur.optional.readOnlyAlert',
    'classeur.optional.recentAlert',
    'classeur.optional.urlDialog',
    'classeur.optional.scrollSync',
    'classeur.optional.settingsPage',
    'classeur.optional.sharingDialog',
    'classeur.optional.spinner',
    'classeur.optional.stat',
    'classeur.optional.sysPage',
    'classeur.optional.tour',
    'classeur.optional.userCursor',
    'classeur.optional.userMgtPage',
    'classeur.optional.zenMode',
    'classeur.extensions.emoji',
    'classeur.extensions.markdown',
    'classeur.extensions.mathJax'
  ])
}
