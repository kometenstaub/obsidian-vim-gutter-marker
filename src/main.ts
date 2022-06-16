import { is } from 'immutable';
import {
	App,
	EventRef,
	Events,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from 'obsidian';
import { around } from 'monkey-around';
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	gutter,
	GutterMarker,
} from '@codemirror/view';
import { Prec, RangeSet, RangeSetBuilder } from '@codemirror/state';

// add type safety for the undocumented methods
declare module 'obsidian' {
	interface Vault {
		setConfig: (config: string, newValue: boolean) => void;
		getConfig: (config: string) => boolean;
	}
}

interface markData {
	mark: string;
	from: number;
	to: number;
}

interface VimMarkSettings {
	showBeforeLineNumbers: boolean;
}

const DEFAULT_SETTINGS: VimMarkSettings = { showBeforeLineNumbers: true };

class VimEvent extends Events {
	on(name: 'vim-setmark', callback: (data: markData[]) => void): EventRef;
	//on(name: 'vim-delmark', callback: (text: string) => void): EventRef;
	on(name: string, callback: (...data: any) => any, ctx?: any): EventRef {
		return super.on(name, callback, ctx);
	}
}

class MarkMarker extends GutterMarker {
	constructor(readonly view: EditorView, readonly marker: string) {
		super();
	}

	toDOM(view: EditorView): Node {
		const markEl = createFragment((frag) => {
			frag.createDiv({ text: this.marker });
		});
		return markEl;
	}

	elementClass = 'vim-gutter-mark';
}

// cm6 view plugin
function vimGutterMarker(evt: VimEvent, showBeforeLineNumbers: boolean) {
	const markers = ViewPlugin.fromClass(
		class {
			markers: RangeSet<MarkMarker>;
			// highlightTime: number;

			constructor(public view: EditorView) {
				this.markers = this.makeGutterMarker(view, []);
				evt.on('vim-setmark', (data) => {
					console.log(data);
					this.markers = this.makeGutterMarker(view, data);
				});
			}
			// update unnecessary because highlight gets removed by timeout; otherwise it would never apply the classes
			// update(update: ViewUpdate) {
			//	if (update.selectionSet || update.docChanged || update.viewportChanged) {
			//		this.decorations = Decoration.none;
			//		// this.makeYankDeco(update.view);
			//
			// }

			makeGutterMarker(view: EditorView, data: markData[]) {
				const builder = new RangeSetBuilder<MarkMarker>();
				if (data.length === 0) {
					this.markers = RangeSet.empty;
					return builder.finish();
				}
				for (const el of data) {
					const dec = new MarkMarker(view, el.mark);
					builder.add(el.from, el.to, dec);
				}
				return builder.finish();
			}
		}
	);
	const gutterPrec = showBeforeLineNumbers ? Prec.high : Prec.low;
	return [
		markers,
		gutterPrec(
			gutter({
				class: 'cm-vim-mark',
				markers(view) {
					return view.plugin(markers)?.markers || RangeSet.empty;
				},
			})
		),
	];
}

export default class MarkGutter extends Plugin {
	settings: VimMarkSettings;
	marks: { mark: string; from: number; to: number }[] | [] = [];
	contentEl: HTMLElement;
	grabKey: (evt: KeyboardEvent) => void;
	oldLeaf: MarkdownView;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new YankSettingTab(this.app, this));
		if (this.app.vault.getConfig('vimMode')) {
			const vimEvent = new VimEvent();

			this.registerEditorExtension(
				vimGutterMarker(vimEvent, this.settings.showBeforeLineNumbers)
			);

			this.registerEvent(
				app.workspace.on('file-open', (file) => {
					if (this.contentEl) {
						this.contentEl.removeEventListener('keydown', this.grabKey, {
							capture: true,
						});
					}
					const currentLeaf = app.workspace.getActiveViewOfType(MarkdownView);
					if (this.oldLeaf !== currentLeaf) {
						this.marks = [];
						vimEvent.trigger('vim-setmarks', this.marks);
					}
					this.oldLeaf = app.workspace.getActiveViewOfType(MarkdownView);

					this.contentEl = currentLeaf.contentEl;
					if (!this.contentEl) {
						return;
					}
					let keyArray: string[] = [];
					let mark = false;
					this.grabKey = (event: KeyboardEvent) => {
						//event.preventDefault();
						//// handle Escape to reject the mode
						//if (event.key === 'Escape') {
						//	contentEl.removeEventListener("keydown", grabKey, { capture: true })
						//}

						/*
					doesn't work
					// @ts-expect-error, not typed
					if (activeWindow.CodeMirrorAdapter.Vim.maybeInitVimState_(app.workspace.getLeaf(false).view.editor.cm.cm).mode !== 'normal'
					) {
						return;
					}
*/

						// test if keypress is capitalized
						if (/^[a-z]$/i.test(event.key)) {
							const isCapital = event.shiftKey;
							if (!isCapital && event.key !== 'm' && keyArray.length === 0) {
								return;
							}
							if (isCapital) {
								// capture uppercase
								keyArray.push(event.key.toUpperCase());
							} else {
								// capture lowercase
								keyArray.push(event.key);
							}
						}

						// stop when length of array is equal to 2
						if (keyArray.length === 2) {
							console.log(keyArray);
							const mode =
								// @ts-expect-error, not typed
								activeWindow.CodeMirrorAdapter.Vim.maybeInitVimState_(
									app.workspace.getLeaf(false).view.editor.cm.cm
								).mode;
							// the mode is not always set, even when it is active
							if (mode === undefined || mode === 'normal') {
								const { editor } = app.workspace.getActiveViewOfType(MarkdownView);
								const cursorFrom = editor.posToOffset(editor.getCursor('from'));
								const cursorTo = editor.posToOffset(editor.getCursor('to'));

								this.marks.push({
									mark: keyArray.at(1),
									from: cursorFrom,
									to: cursorTo,
								});
								this.marks.sort(
									(
										a: {
											mark: string;
											from: number;
											to: number;
										},
										b: {
											mark: string;
											from: number;
											to: number;
										}
									) => {
										if (a.from < b.from) {
											return -1;
										}
										if (a.from > b.from) {
											return 1;
										}
										return 0;
									}
								);
								vimEvent.trigger('vim-setmark', this.marks);
								console.log('mark set');
							}
							keyArray = [];
							console.log('clear array');
							console.log(keyArray);
							// removing eventListener after proceeded
							//contentEl.removeEventListener("keydown", grabKey, { capture: false })
						}
					};
					this.contentEl.addEventListener('keydown', this.grabKey, {
						capture: true,
						passive: true,
					});
				})
			);
		}
		console.log('Yank Highlight plugin loaded.');
	}
	async onunload() {
		console.log('Yank Highlight plugin unloaded.');
	}
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class YankSettingTab extends PluginSettingTab {
	plugin: MarkGutter;

	constructor(app: App, plugin: MarkGutter) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const { settings } = this.plugin;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Vim Gutter Marker settings' });

		new Setting(containerEl)
			.setName('Show marker before line numbers')
			.setDesc('If enabled, the markers will be shown before the line numbers.')
			.addToggle((toggle) => {
				toggle.setValue(settings.showBeforeLineNumbers).onChange(async (state) => {
					settings.showBeforeLineNumbers = state;
					await this.plugin.saveSettings();
				});
			});
	}
}
