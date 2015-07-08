angular.module('classeur.core.editor', [])
	.directive('clEditor',
		function($window, $timeout, $$sanitizeUri, clEditorSvc, clEditorLayoutSvc, clSettingSvc, clKeystrokeSvc) {
			return {
				restrict: 'E',
				templateUrl: 'core/editor/editor.html',
				link: link
			};

			function link(scope, element) {
				var containerElt = element[0].querySelector('.editor.container');
				var editorElt = element[0].querySelector('.editor.content');
				clEditorSvc.setCurrentFileDao(scope.currentFileDao);
				clEditorSvc.initConverter();
				clEditorSvc.setEditorElt(editorElt);
				clEditorSvc.pagedownEditor.hooks.set('insertLinkDialog', function(callback) {
					clEditorSvc.linkDialogCallback = callback;
					clEditorLayoutSvc.currentControl = 'linkDialog';
					scope.$evalAsync();
					return true;
				});
				clEditorSvc.pagedownEditor.hooks.set('insertImageDialog', function(callback) {
					clEditorSvc.imageDialogCallback = callback;
					clEditorLayoutSvc.currentControl = 'imageDialog';
					scope.$evalAsync();
					return true;
				});

				var state;
				scope.$on('$destroy', function() {
					state = 'destroyed';
				});

				function checkState() {
					return state === 'destroyed';
				}

				function saveState() {
					scope.currentFileDao.contentDao.state = {
						selectionStart: clEditorSvc.cledit.selectionMgr.selectionStart,
						selectionEnd: clEditorSvc.cledit.selectionMgr.selectionEnd,
						scrollTop: containerElt.scrollTop,
					};
				}
				containerElt.addEventListener('scroll', saveState);

				var newSectionList, newSelectionRange;
				var debouncedEditorChanged = $window.cledit.Utils.debounce(function() {
					if (checkState()) {
						return;
					}
					if (clEditorSvc.sectionList !== newSectionList) {
						clEditorSvc.sectionList = newSectionList;
						state ? debouncedRefreshPreview() : refreshPreview();
					}
					clEditorSvc.selectionRange = newSelectionRange;
					scope.currentFileDao.contentDao.text = clEditorSvc.cledit.getContent();
					saveState();
					clEditorSvc.lastContentChange = Date.now();
					scope.$apply();
				}, 10);

				function refreshPreview() {
					state = 'ready';
					clEditorSvc.convert();
					setTimeout(function() {
						clEditorSvc.refreshPreview(scope.$apply.bind(scope));
					}, 10);
				}

				var debouncedRefreshPreview = $window.cledit.Utils.debounce(function() {
					if (checkState()) {
						return;
					}
					refreshPreview();
					scope.$apply();
				}, 20);

				clEditorSvc.cledit.on('contentChanged', function(content, sectionList) {
					newSectionList = sectionList;
					debouncedEditorChanged();
				});

				clEditorSvc.cledit.selectionMgr.on('selectionChanged', function(start, end, selectionRange) {
					newSelectionRange = selectionRange;
					debouncedEditorChanged();
				});

				if (clSettingSvc.values.editorInlineImg) {
					clEditorSvc.cledit.highlighter.on('sectionHighlighted', function(section) {
						section.imgTokenEltList = section.elt.getElementsByClassName('token img');
						Array.prototype.slice.call(section.imgTokenEltList).forEach(function(imgTokenElt) {
							var srcElt = imgTokenElt.querySelector('.token.md-src');
							if (srcElt) {
								var imgElt = $window.document.createElement('img');
								imgElt.style.display = 'none';
								var uri = srcElt.textContent;
								if (!/^unsafe/.test($$sanitizeUri(uri, true))) {
									imgElt.onload = function() {
										imgElt.style.display = '';
									};
									imgElt.src = uri;
								}
								imgTokenElt.insertBefore(imgElt, imgTokenElt.firstChild);
							}
						});
					});
				}

				// Add custom keystrokes
				clKeystrokeSvc(clEditorSvc);

				var isInited;
				scope.$watch('editorSvc.options', function(options) {
					clEditorSvc.forcePreviewRefresh();
					options = angular.extend({}, options);
					if (!isInited) {
						options.content = scope.currentFileDao.contentDao.text;
						['selectionStart', 'selectionEnd', 'scrollTop'].forEach(function(key) {
							options[key] = scope.currentFileDao.contentDao.state[key];
						});
						isInited = true;
					}
					clEditorSvc.initCledit(options);
				});
				scope.$watch('editorLayoutSvc.isEditorOpen', function(isOpen) {
					clEditorSvc.cledit.toggleEditable(isOpen);
				});


				function onPreviewRefreshed(refreshed) {
					(refreshed && !clEditorSvc.lastSectionMeasured) ?
					clEditorSvc.measureSectionDimensions():
						debouncedMeasureSectionDimension();
				}

				var debouncedMeasureSectionDimension = $window.cledit.Utils.debounce(function() {
					if (checkState()) {
						return;
					}
					clEditorSvc.measureSectionDimensions();
					scope.$apply();
				}, 1000);
				scope.$watch('editorSvc.lastPreviewRefreshed', onPreviewRefreshed);
				scope.$watch('editorSvc.editorSize()', debouncedMeasureSectionDimension);
				scope.$watch('editorSvc.previewSize()', debouncedMeasureSectionDimension);
				scope.$watch('editorLayoutSvc.isPreviewVisible', function(isVisible) {
					isVisible && state && clEditorSvc.measureSectionDimensions();
				});
				scope.$watch('editorLayoutSvc.currentControl', function(currentControl) {
					!currentControl && setTimeout(function() {
						clEditorSvc.cledit && clEditorSvc.cledit.focus();
					}, 1);
				});
			}
		})
	.directive('clPreview',
		function($window, clEditorSvc, clConfig) {
			var appUri = clConfig.appUri || '';

			return {
				restrict: 'E',
				templateUrl: 'core/editor/preview.html',
				link: link
			};

			function link(scope, element) {
				clEditorSvc.setPreviewElt(element[0].querySelector('.preview.content'));
				var containerElt = element[0].querySelector('.preview.container');
				clEditorSvc.isPreviewTop = containerElt.scrollTop < 10;
				containerElt.addEventListener('scroll', function() {
					var isPreviewTop = containerElt.scrollTop < 10;
					if (isPreviewTop !== clEditorSvc.isPreviewTop) {
						clEditorSvc.isPreviewTop = isPreviewTop;
						scope.$apply();
					}
				});
				containerElt.addEventListener('click', function(evt) {
					var elt = evt.target;
					while (elt !== containerElt) {
						if (elt.href) {
							if (elt.href.match(/^https?:\/\//) && elt.href.slice(0, appUri.length) !== appUri) {
								evt.preventDefault();
								var wnd = window.open(elt.href, '_blank');
								return wnd.focus();
							}
						}
						elt = elt.parentNode;
					}
				});
			}
		})
	.directive('clToc',
		function(clEditorSvc) {
			return {
				restrict: 'E',
				template: '<div class="toc content no-select"></div>',
				link: link
			};

			function link(scope, element) {
				var tocElt = element[0].querySelector('.toc.content');
				clEditorSvc.setTocElt(tocElt);

				var isMousedown;
				var scrollerElt = tocElt;
				while (scrollerElt && scrollerElt.tagName !== 'MD-TAB-CONTENT') {
					scrollerElt = scrollerElt.parentNode;
				}

				function onClick(e) {
					if (!isMousedown) {
						return;
					}
					e.preventDefault();
					var y = e.clientY + scrollerElt.scrollTop;

					clEditorSvc.sectionDescList.some(function(sectionDesc) {
						if (y < sectionDesc.tocDimension.endOffset) {
							var posInSection = (y - sectionDesc.tocDimension.startOffset) / (sectionDesc.tocDimension.height || 1);
							var editorScrollTop = sectionDesc.editorDimension.startOffset + sectionDesc.editorDimension.height * posInSection;
							clEditorSvc.editorElt.parentNode.scrollTop = editorScrollTop - clEditorSvc.scrollOffset;
							var previewScrollTop = sectionDesc.previewDimension.startOffset + sectionDesc.previewDimension.height * posInSection;
							clEditorSvc.previewElt.parentNode.scrollTop = previewScrollTop - clEditorSvc.scrollOffset;
							return true;
						}
					});
				}

				tocElt.addEventListener("mouseup", function() {
					isMousedown = false;
				});
				tocElt.addEventListener("mouseleave", function() {
					isMousedown = false;
				});
				tocElt.addEventListener("mousedown", function(e) {
					isMousedown = e.which === 1;
					onClick(e);
				});
				tocElt.addEventListener("mousemove", function(e) {
					onClick(e);
				});
			}
		})
	.factory('clEditorClassApplier',
		function($window, clEditorSvc) {
			function ClassApplier(classes, offsetGetter, properties) {
				classes = typeof classes === 'string' ? [classes] : classes;
				var self = this;
				$window.cledit.Utils.createEventHooks(this);
				this.elts = clEditorSvc.editorElt.getElementsByClassName(classes[0]);
				var lastEltCount;

				function applyClass() {
					var offset = offsetGetter();
					if (!offset) {
						return;
					}
					var range = clEditorSvc.cledit.selectionMgr.createRange(
						Math.min(offset.start, offset.end),
						Math.max(offset.start, offset.end)
					);
					properties = properties || {};
					properties.className = classes.join(' ');
					var rangeLength = ('' + range).length;
					var wrappedLength = 0;
					var treeWalker = $window.document.createTreeWalker(clEditorSvc.editorElt, NodeFilter.SHOW_TEXT);
					var startOffset = range.startOffset;
					treeWalker.currentNode = range.startContainer;
					if (treeWalker.currentNode.nodeType === Node.TEXT_NODE || treeWalker.nextNode()) {
						clEditorSvc.cledit.watcher.noWatch(function() {
							do {
								if (treeWalker.currentNode.nodeValue !== '\n') {
									if (treeWalker.currentNode === range.endContainer && range.endOffset < treeWalker.currentNode.nodeValue.length) {
										treeWalker.currentNode.splitText(range.endOffset);
									}
									if (startOffset) {
										treeWalker.currentNode = treeWalker.currentNode.splitText(startOffset);
										startOffset = 0;
									}
									var elt = $window.document.createElement('span');
									for (var key in properties) {
										elt[key] = properties[key];
									}
									treeWalker.currentNode.parentNode.insertBefore(elt, treeWalker.currentNode);
									elt.appendChild(treeWalker.currentNode);
								}
								wrappedLength += treeWalker.currentNode.nodeValue.length;
								if (wrappedLength >= rangeLength) {
									break;
								}
							}
							while (treeWalker.nextNode());
						});
					}
					self.$trigger('classApplied');
					clEditorSvc.cledit.selectionMgr.restoreSelection();
					lastEltCount = self.elts.length;
				}

				function removeClass() {
					clEditorSvc.cledit.watcher.noWatch(function() {
						Array.prototype.slice.call(self.elts).forEach(function(elt) {
							var child = elt.firstChild;
							if (child.nodeType === 3) {
								if (elt.previousSibling && elt.previousSibling.nodeType === 3) {
									child.nodeValue = elt.previousSibling.nodeValue + child.nodeValue;
									elt.parentNode.removeChild(elt.previousSibling);
								}
								if (elt.nextSibling && elt.nextSibling.nodeType === 3) {
									child.nodeValue = child.nodeValue + elt.nextSibling.nodeValue;
									elt.parentNode.removeChild(elt.nextSibling);
								}
							}
							elt.parentNode.insertBefore(child, elt);
							elt.parentNode.removeChild(elt);
						});
					});
				}

				function restoreClass() {
					if (self.elts.length !== lastEltCount) {
						removeClass();
						applyClass();
					}
				}

				this.stop = function() {
					clEditorSvc.cledit.off('contentChanged', restoreClass);
					removeClass();
				};

				clEditorSvc.cledit.on('contentChanged', restoreClass);
				applyClass();
			}

			return function(classes, offsetGetter, properties) {
				return new ClassApplier(classes, offsetGetter, properties);
			};
		})
	.factory('clEditorSvc',
		function($window, $timeout, clSettingSvc, clEditorLayoutSvc, clScrollAnimation, clHtmlSanitizer, clPagedown, Slug) {

			// Create aliases for syntax highlighting
			var Prism = $window.Prism;
			angular.forEach({
				'js': 'javascript',
				'html': 'markup',
				'svg': 'markup',
				'xml': 'markup',
				'py': 'python',
				'rb': 'ruby',
				'ps1': 'powershell',
				'psm1': 'powershell'
			}, function(name, alias) {
				Prism.languages[alias] = Prism.languages[name];
			});

			var insideFcb = {};
			angular.forEach(Prism.languages, function(language, name) {
				if (Prism.util.type(language) === 'Object') {
					insideFcb['language-' + name] = {
						pattern: new RegExp('`{3}' + name + '\\W[\\s\\S]*'),
						inside: {
							"md md-pre": /`{3}.*/,
							rest: language
						}
					};
				}
			});

			Prism.hooks.add('wrap', function(env) {
				if (env.type === 'code' || env.type.match(/^pre($|\b)/)) {
					env.attributes.spellcheck = 'false';
				}
			});

			var editorElt, previewElt, tocElt;
			var filenameSpaceElt;
			var prismOptions = {
				insideFcb: insideFcb
			};
			var forcePreviewRefresh = true;
			var markdownInitListeners = [];
			var converterInitListeners = [];
			var asyncPreviewListeners = [];
			var currentFileDao;
			var startSectionBlockTypes = ['paragraph_open', 'blockquote_open', 'heading_open', 'code', 'fence', 'table_open', 'htmlblock', 'dl_open', 'bullet_list_open', 'ordered_list_open', 'hr'];
			var startSectionBlockTypesRegex = new RegExp('^(?:' + startSectionBlockTypes.join('|') + ')$');
			var htmlSectionMarker = '\uF111\uF222\uF333\uF444';
			var diffMatchPatch = new $window.diff_match_patch();
			var parsingCtx, conversionCtx;

			var clEditorSvc = {
				options: {},
				setCurrentFileDao: function(fileDao) {
					currentFileDao = fileDao;
				},
				onMarkdownInit: function(priority, listener) {
					markdownInitListeners[priority] = listener;
				},
				initConverter: function() {
					clEditorSvc.converter = new $window.Markdown.Converter();
					clEditorSvc.markdown = new $window.Remarkable('full');
					asyncPreviewListeners = [];
					markdownInitListeners.forEach(function(listener) {
						listener(clEditorSvc.markdown);
					});
					startSectionBlockTypes.forEach(function(type) {
						var rule = clEditorSvc.markdown.renderer.rules[type];
						clEditorSvc.markdown.renderer.rules[type] = function(tokens, idx) {
							if (tokens[idx].sectionDelimiter) {
								return htmlSectionMarker + rule.apply(clEditorSvc.markdown.renderer, arguments);
							}
							return rule.apply(clEditorSvc.markdown.renderer, arguments);
						};
					});
					clEditorSvc.markdown.renderer.rules.footnote_ref = function(tokens, idx) {
						var n = Number(tokens[idx].id + 1).toString();
						var id = 'fnref' + n;
						if (tokens[idx].subId > 0) {
							id += ':' + tokens[idx].subId;
						}
						return '<sup class="footnote-ref"><a href="#fn' + n + '" id="' + id + '">' + n + '</a></sup>';
					};

					converterInitListeners.forEach(function(listener) {
						listener(clEditorSvc.converter);
					});
				},
				onInitConverter: function(priority, listener) {
					converterInitListeners[priority] = listener;
				},
				hasInitListener: function(priority) {
					return converterInitListeners.hasOwnProperty(priority);
				},
				onAsyncPreview: function(listener) {
					asyncPreviewListeners.push(listener);
				},
				forcePreviewRefresh: function() {
					forcePreviewRefresh = true;
				},
				setPrismOptions: function(options) {
					prismOptions = angular.extend(prismOptions, options);
					this.prismGrammar = $window.mdGrammar(prismOptions);
					// Create new object for watchers
					this.options = angular.extend({}, this.options);
					this.options.highlighter = function(text) {
						return Prism.highlight(text, clEditorSvc.prismGrammar);
					};
				},
				setPreviewElt: function(elt) {
					previewElt = elt;
					this.previewElt = elt;
					filenameSpaceElt = elt.querySelector('.filename.space');
				},
				setTocElt: function(elt) {
					tocElt = elt;
					this.tocElt = elt;
				},
				setEditorElt: function(elt) {
					editorElt = elt;
					this.editorElt = elt;
					parsingCtx = undefined;
					conversionCtx = undefined;
					clEditorSvc.sectionDescList = [];
					clEditorSvc.cledit = $window.cledit(elt, elt.parentNode);
					clEditorSvc.cledit.on('contentChanged', function(content, sectionList) {
						parsingCtx.sectionList = sectionList;
					});
					clEditorSvc.pagedownEditor = clPagedown({
						input: Object.create(clEditorSvc.cledit)
					});
					clEditorSvc.pagedownEditor.run();
				},
				initCledit: function(options) {
					options.sectionParser = function(text) {
						var markdownState = {
							src: text,
							env: {},
							options: clEditorSvc.markdown.options,
							tokens: [],
							inlineMode: false,
							inline: clEditorSvc.markdown.inline,
							block: clEditorSvc.markdown.block,
							renderer: clEditorSvc.markdown.renderer,
							typographer: clEditorSvc.markdown.typographer,
						};
						var markdownCoreRules = clEditorSvc.markdown.core.ruler.getRules('');
						markdownCoreRules[0](markdownState); // Pass the block rule
						var lines = text.split('\n');
						lines.pop(); // Assume last char is a '\n'
						var sections = [],
							i = 0;
						parsingCtx = {
							markdownState: markdownState,
							markdownCoreRules: markdownCoreRules
						};

						function addSection(maxLine) {
							var section = '';
							while (i < maxLine) {
								section += lines[i++] + '\n';
							}
							section && sections.push(section);
						}
						markdownState.tokens.forEach(function(token) {
							if (token.level === 0 && token.type.match(startSectionBlockTypesRegex)) {
								token.sectionDelimiter = true;
								addSection(token.lines[0]);
							}
						});
						addSection(lines.length);
						return sections;
					};
					clEditorSvc.cledit.init(options);
				},
				setContent: function(content, isExternal) {
					if (clEditorSvc.cledit) {
						if (isExternal) {
							clEditorSvc.lastExternalChange = Date.now();
						}
						return clEditorSvc.cledit.setContent(content, isExternal);
					}
				},
				editorSize: function() {
					return editorElt.clientWidth + 'x' + editorElt.clientHeight;
				},
				previewSize: function() {
					return previewElt.clientWidth + 'x' + previewElt.clientHeight;
				}
			};
			clEditorSvc.lastExternalChange = 0;
			clEditorSvc.scrollOffset = 80;

			function hashArray(arr, valueHash, valueArray) {
				var hash = [];
				arr.forEach(function(str) {
					var strHash;
					if (!valueHash.hasOwnProperty(str)) {
						strHash = valueArray.length;
						valueArray.push(str);
						valueHash[str] = strHash;
					} else {
						strHash = valueHash[str];
					}
					hash.push(strHash);
				});
				return String.fromCharCode.apply(null, hash);
			}

			clEditorSvc.convert = function() {
				!parsingCtx.markdownState.isConverted && parsingCtx.markdownCoreRules.slice(1).forEach(function(rule) { // Skip the block rule already passed
					rule(parsingCtx.markdownState);
				});
				parsingCtx.markdownState.isConverted = true;
				var html = clEditorSvc.markdown.renderer.render(parsingCtx.markdownState.tokens, clEditorSvc.markdown.options, parsingCtx.markdownState.env);
				var htmlSectionList = html.split(htmlSectionMarker);
				htmlSectionList[0] === '' && htmlSectionList.shift();
				var valueHash = {},
					valueArray = [];
				var newSectionHash = hashArray(htmlSectionList, valueHash, valueArray);
				var htmlSectionDiff = [
					[1, newSectionHash]
				];
				if (conversionCtx) {
					var oldSectionHash = hashArray(conversionCtx.htmlSectionList, valueHash, valueArray);
					htmlSectionDiff = diffMatchPatch.diff_main(oldSectionHash, newSectionHash);
				}
				conversionCtx = {
					sectionList: parsingCtx.sectionList,
					htmlSectionList: htmlSectionList,
					htmlSectionDiff: htmlSectionDiff
				};
				clEditorSvc.lastConversion = Date.now();
			};

			var anchorHash = {};

			clEditorSvc.refreshPreview = function(cb) {
				var newSectionDescList = [];
				var sectionPreviewElt, sectionTocElt;
				var sectionIdx = 0,
					sectionDescIdx = 0;
				var insertBeforePreviewElt = filenameSpaceElt.nextSibling,
					insertBeforeTocElt = tocElt.firstChild;
				conversionCtx.htmlSectionDiff.forEach(function(item) {
					for (var i = 0; i < item[1].length; i++) {
						if (item[0] === 0) {
							newSectionDescList.push(clEditorSvc.sectionDescList[sectionDescIdx++]);
							sectionIdx++;
							insertBeforePreviewElt.classList.remove('modified');
							insertBeforePreviewElt = insertBeforePreviewElt.nextSibling;
							insertBeforeTocElt.classList.remove('modified');
							insertBeforeTocElt = insertBeforeTocElt.nextSibling;
						} else if (item[0] === -1) {
							sectionDescIdx++;
							sectionPreviewElt = insertBeforePreviewElt;
							insertBeforePreviewElt = insertBeforePreviewElt.nextSibling;
							previewElt.removeChild(sectionPreviewElt);
							sectionTocElt = insertBeforeTocElt;
							insertBeforeTocElt = insertBeforeTocElt.nextSibling;
							tocElt.removeChild(sectionTocElt);
						} else if (item[0] === 1) {
							var section = conversionCtx.sectionList[sectionIdx];
							var html = conversionCtx.htmlSectionList[sectionIdx++];

							// Create section preview element
							sectionPreviewElt = document.createElement('div');
							sectionPreviewElt.id = 'classeur-preview-section-' + section.id;
							sectionPreviewElt.className = 'classeur-preview-section modified';
							sectionPreviewElt.innerHTML = clHtmlSanitizer(html);
							if (insertBeforePreviewElt) {
								previewElt.insertBefore(sectionPreviewElt, insertBeforePreviewElt);
							} else {
								previewElt.appendChild(sectionPreviewElt);
							}

							// Create section TOC element
							sectionTocElt = document.createElement('div');
							sectionTocElt.id = 'classeur-toc-section-' + section.id;
							sectionTocElt.className = 'classeur-toc-section modified';
							var headingElt = sectionPreviewElt.querySelector('h1, h2, h3, h4, h5, h6');
							headingElt && sectionTocElt.appendChild(headingElt.cloneNode(true));
							if (insertBeforeTocElt) {
								tocElt.insertBefore(sectionTocElt, insertBeforeTocElt);
							} else {
								tocElt.appendChild(sectionTocElt);
							}

							newSectionDescList.push({
								id: section.id,
								editorElt: section.elt,
								previewElt: sectionPreviewElt,
								tocElt: sectionTocElt
							});
						}
					}
				});
				clEditorSvc.sectionDescList = newSectionDescList;

				// Create anchors
				anchorHash = {};
				Array.prototype.forEach.call(previewElt.querySelectorAll('h1, h2, h3, h4, h5, h6'), function(elt) {
					var sectionDesc = elt.parentNode.sectionDesc;
					if (!sectionDesc) {
						return;
					}
					if (elt.id && !elt.generatedAnchor) {
						anchorHash[elt.id] = sectionDesc;
						return;
					}
					var id = Slug.slugify(elt.textContent) || 'heading';
					var anchor = id;
					var index = 0;
					while (anchorHash.hasOwnProperty(anchor)) {
						anchor = id + '-' + (++index);
					}
					anchorHash[anchor] = sectionDesc;
					elt.id = anchor;
					elt.generatedAnchor = true;
				});

				runAsyncPreview(cb);
			};

			function runAsyncPreview(cb) {
				function recursiveCall(callbackList) {
					if (callbackList.length) {
						return callbackList.shift()(function() {
							recursiveCall(callbackList);
						});
					}
					var html = Array.prototype.reduce.call(previewElt.querySelectorAll('.classeur-preview-section'), function(html, elt) {
						if (!elt.exportableHtml) {
							var clonedElt = elt.cloneNode(true);
							Array.prototype.forEach.call(clonedElt.querySelectorAll('.MathJax, .MathJax_Display, .MathJax_Preview'), function(elt) {
								elt.parentNode.removeChild(elt);
							});
							elt.exportableHtml = clonedElt.innerHTML;
						}
						return html + elt.exportableHtml;
					}, '');
					clEditorSvc.previewHtml = html.replace(/^\s+|\s+$/g, '');
					clEditorSvc.previewText = previewElt.textContent;
					clEditorSvc.lastPreviewRefreshed = Date.now();
					cb();
				}

				var imgLoadingListeners = Array.prototype.map.call(previewElt.querySelectorAll('img'), function(imgElt) {
					return function(cb) {
						if (!imgElt.src) {
							return cb();
						}
						var img = new Image();
						img.onload = cb;
						img.onerror = cb;
						img.src = imgElt.src;
					};
				});
				recursiveCall(asyncPreviewListeners.concat(imgLoadingListeners));
			}

			function SectionDimension(startOffset, endOffset) {
				this.startOffset = startOffset;
				this.endOffset = endOffset;
				this.height = endOffset - startOffset;
			}

			function dimensionNormalizer(dimensionName) {
				return function() {
					var dimensionList = clEditorSvc.sectionDescList.map(function(sectionDesc) {
						return sectionDesc[dimensionName];
					});
					var dimension, i, j;
					for (i = 0; i < dimensionList.length; i++) {
						dimension = dimensionList[i];
						if (!dimension.height) {
							continue;
						}
						for (j = i + 1; j < dimensionList.length && dimensionList[j].height === 0; j++) {}
						var normalizeFactor = j - i;
						if (normalizeFactor === 1) {
							continue;
						}
						var normizedHeight = dimension.height / normalizeFactor;
						dimension.height = normizedHeight;
						dimension.endOffset = dimension.startOffset + dimension.height;
						for (j = i + 1; j < i + normalizeFactor; j++) {
							var startOffset = dimension.endOffset;
							dimension = dimensionList[j];
							dimension.startOffset = startOffset;
							dimension.height = normizedHeight;
							dimension.endOffset = dimension.startOffset + dimension.height;
						}
						i = j - 1;
					}
				};
			}

			var normalizeEditorDimensions = dimensionNormalizer('editorDimension');
			var normalizePreviewDimensions = dimensionNormalizer('previewDimension');
			var normalizeTocDimensions = dimensionNormalizer('tocDimension');

			clEditorSvc.measureSectionDimensions = function() {
				var editorSectionOffset = 0;
				var previewSectionOffset = 0;
				var tocSectionOffset = 0;
				var sectionDesc = clEditorSvc.sectionDescList[0];
				var nextSectionDesc;
				for (var i = 1; i < clEditorSvc.sectionDescList.length; i++) {
					nextSectionDesc = clEditorSvc.sectionDescList[i];

					// Measure editor section
					var newEditorSectionOffset = nextSectionDesc.editorElt && nextSectionDesc.editorElt.firstChild ? nextSectionDesc.editorElt.firstChild.offsetTop : editorSectionOffset;
					newEditorSectionOffset = newEditorSectionOffset > editorSectionOffset ? newEditorSectionOffset : editorSectionOffset;
					sectionDesc.editorDimension = new SectionDimension(editorSectionOffset, newEditorSectionOffset);
					editorSectionOffset = newEditorSectionOffset;

					// Measure preview section
					var newPreviewSectionOffset = nextSectionDesc.previewElt ? nextSectionDesc.previewElt.offsetTop : previewSectionOffset;
					newPreviewSectionOffset = newPreviewSectionOffset > previewSectionOffset ? newPreviewSectionOffset : previewSectionOffset;
					sectionDesc.previewDimension = new SectionDimension(previewSectionOffset, newPreviewSectionOffset);
					previewSectionOffset = newPreviewSectionOffset;

					// Measure TOC section
					var newTocSectionOffset = nextSectionDesc.tocElt ? nextSectionDesc.tocElt.offsetTop + nextSectionDesc.tocElt.offsetHeight / 2 : tocSectionOffset;
					newTocSectionOffset = newTocSectionOffset > tocSectionOffset ? newTocSectionOffset : tocSectionOffset;
					sectionDesc.tocDimension = new SectionDimension(tocSectionOffset, newTocSectionOffset);
					tocSectionOffset = newTocSectionOffset;

					sectionDesc = nextSectionDesc;
				}

				// Last section
				sectionDesc = clEditorSvc.sectionDescList[i - 1];
				if (sectionDesc) {
					sectionDesc.editorDimension = new SectionDimension(editorSectionOffset, editorElt.scrollHeight);
					sectionDesc.previewDimension = new SectionDimension(previewSectionOffset, previewElt.scrollHeight);
					sectionDesc.tocDimension = new SectionDimension(tocSectionOffset, tocElt.scrollHeight);
				}

				normalizeEditorDimensions();
				normalizePreviewDimensions();
				normalizeTocDimensions();

				clEditorSvc.lastSectionMeasured = Date.now();
			};

			clEditorSvc.scrollToAnchor = function(anchor) {
				var scrollTop = 0,
					scrollerElt = clEditorSvc.previewElt.parentNode;
				var sectionDesc = anchorHash[anchor];
				if (sectionDesc) {
					if (clEditorLayoutSvc.isPreviewVisible) {
						scrollTop = sectionDesc.previewDimension.startOffset - filenameSpaceElt.offsetHeight;
					} else {
						scrollTop = sectionDesc.editorDimension.startOffset - clEditorSvc.scrollOffset;
						scrollerElt = clEditorSvc.editorElt.parentNode;
					}
				} else {
					var elt = document.getElementById(anchor);
					if (elt) {
						scrollTop = elt.offsetTop - filenameSpaceElt.offsetHeight;
					}
				}
				clScrollAnimation(scrollerElt, scrollTop > 0 ? scrollTop : 0);
			};

			clEditorSvc.applyTemplate = function(template) {
				var view = {
					file: {
						name: currentFileDao.name,
						content: {
							text: currentFileDao.contentDao.text,
							html: clEditorSvc.previewHtml,
						},
						properties: currentFileDao.contentDao.properties
					}
				};
				return $window.Mustache.render(template, view);
			};

			return clEditorSvc;
		})
	.run(
		function($window, $rootScope, $location, $route, clEditorSvc) {

			var lastSectionMeasured = clEditorSvc.lastSectionMeasured;
			var unwatch = $rootScope.$watch('editorSvc.lastSectionMeasured', function(value) {
				var hash = $location.hash();
				if (hash && value !== lastSectionMeasured) {
					clEditorSvc.scrollToAnchor(hash);
					unwatch();
				}
			});

			$rootScope.$on('$locationChangeStart', function(evt, urlAfter, urlBefore) {
				if (urlBefore !== urlAfter) {
					var splitUrl = urlAfter.split('#');
					if (splitUrl.length === 3) {
						var hash = splitUrl[2];
						var hashPos = splitUrl[0].length + splitUrl[1].length;
						if (urlBefore.slice(0, hashPos) === urlAfter.slice(0, hashPos)) {
							evt.preventDefault();
							clEditorSvc.scrollToAnchor(hash);
						}
					}
				}
			});
		});
