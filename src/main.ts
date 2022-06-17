import { App, EventRef, Events, MarkdownView, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { EditorView, ViewPlugin, gutter, GutterMarker } from '@codemirror/view';
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

// based on https://github.com/liamcain/obsidian-lapel/blob/dce7a1d9fc8ac9a2c8d3589b0e4f92d1f0241f39/src/headingWidget.ts (MIT-licensed)
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
// based on https://github.com/liamcain/obsidian-lapel/blob/dce7a1d9fc8ac9a2c8d3589b0e4f92d1f0241f39/src/headingWidget.ts (MIT-licensed)
function vimGutterMarker(app: App, evt: VimEvent, showBeforeLineNumbers: boolean) {
	const markers = ViewPlugin.fromClass(
		class {
			markers: RangeSet<MarkMarker>;

			constructor(public view: EditorView) {
				evt.on('vim-setmark', (data) => {
					this.markers = this.makeGutterMarker(view, data);
				});
			}
			//update unnecessary because highlight gets removed by timeout; otherwise it would never apply the classes
			//update(update: ViewUpdate) {
			//	if (!update.state.field(editorLivePreviewField)) {
			//		this.markers = RangeSet.empty;
			//		return;
			//	}
			//	this.markers = this.makeGutterMarker(this.view, this.oldData);
			//}

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
	marks: markData[] | [] = [];
	contentEl: HTMLElement;
	grabKey: (evt: KeyboardEvent) => void;
	oldLeaf: MarkdownView;
	leaves: Set<{ path: string; id: string; marks?: markData[] }> = new Set();
	oldContentEl: HTMLElement;

	async onload() {
		console.log('Vim Gutter Marker plugin loading.');
		await this.loadSettings();
		this.addSettingTab(new VimGutterSettingTab(this.app, this));
		if (this.app.vault.getConfig('vimMode')) {
			const vimEvent = new VimEvent();

			this.registerEditorExtension(
				vimGutterMarker(app, vimEvent, this.settings.showBeforeLineNumbers)
			);

			this.registerEvent(
				app.workspace.on('file-open', async (file) => {
					if (this.oldContentEl) {
						this.oldContentEl.removeEventListener('keydown', this.grabKey, {
							capture: true,
						});
					}
					// reset marks for new pane; get them from history later, if available
					this.marks = [];
					const currentLeaf = app.workspace.getActiveViewOfType(MarkdownView);
					if (!currentLeaf) {
						return;
					}
					const currentId: string = app.workspace.getLeaf(false).id;
					const leaves = Array.from(this.leaves);
					// focus changed between panes, but file in pane didn't change, so old marks are still there,
					// but not in the gutter anymore - add old marks back
					if (this.oldLeaf !== currentLeaf) {
						const result = leaves.find((el) => {
							if (el.id === currentId) {
								if (el.marks) {
									this.marks = el.marks;
									vimEvent.trigger('vim-setmark', this.marks);
								}
								return true;
							}
						});
						// new leaf, old ones don't get added
						if (!result) {
							this.leaves.add({
								path: file.path,
								id: currentId,
							});
						}
					}
					// check if there are still marks in the same leaf
					// this can be the case when only the file changed, but no other
					// leaf was opened
					if (this.oldLeaf === currentLeaf) {
						//if (currentLeaf.getViewType() ===)
						const myMarks = await currentLeaf.editor.cm.cm.marks;
						const markLength = Object.keys(myMarks).length;
						if (markLength === 0) {
							// otherwise cm6 remembers them for the editor in which marks
							// were set before
							this.marks = [];
							vimEvent.trigger('vim-setmark', this.marks);
						}
					}
					this.oldLeaf = app.workspace.getActiveViewOfType(MarkdownView);

					this.contentEl = currentLeaf.contentEl;
					if (!this.contentEl) {
						return;
					}
					// for removing the event listener on the next file-open event
					this.oldContentEl = currentLeaf.contentEl;
					// adapted from: https://github.com/mrjackphil/obsidian-jump-to-link/issues/35#issuecomment-1085905668
					let keyArray: string[] = [];
					this.grabKey = (event: KeyboardEvent) => {
						if (currentLeaf.getMode() === 'preview') {
							return;
						}

						// empty array if Esc
						if (event.key === 'Escape') {
							keyArray = [];
							return;
						}

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
							const mode =
								// @ts-expect-error, not typed
								window.CodeMirrorAdapter.Vim.maybeInitVimState_(
									app.workspace.getLeaf(false).view.editor.cm.cm
								).mode;
							// the mode is not always set, even when it is active
							if (mode === undefined || mode === 'normal') {
								const { editor } = app.workspace.getActiveViewOfType(MarkdownView);
								const intCursorFrom = editor.getCursor('from');
								intCursorFrom.ch = 0;
								const intCursorTo = editor.getCursor('to');
								intCursorTo.ch = 0;
								const cursorFrom = editor.posToOffset(intCursorFrom);
								const cursorTo = editor.posToOffset(intCursorTo);

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
								// for later comparison
								const leaves = Array.from(this.leaves);
								const currentEl = leaves.find((el) => {
									if (el.id === currentId) {
										return true;
									}
								});

								currentEl['marks'] = this.marks;
								leaves.push(currentEl);
								this.leaves = new Set(leaves);
								vimEvent.trigger('vim-setmark', this.marks);
							}
							keyArray = [];
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
	}
	async onunload() {
		if (this.oldContentEl) {
			this.oldContentEl.removeEventListener('keydown', this.grabKey, {
				capture: true,
			});
		}
		console.log('Vim Gutter Marker plugin unloaded.');
	}
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class VimGutterSettingTab extends PluginSettingTab {
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
			.setDesc(
				'If enabled, the markers will be shown before the line numbers. Requires a reload to take effect.'
			)
			.addToggle((toggle) => {
				toggle.setValue(settings.showBeforeLineNumbers).onChange(async (state) => {
					settings.showBeforeLineNumbers = state;
					await this.plugin.saveSettings();
				});
			});
	}
}
