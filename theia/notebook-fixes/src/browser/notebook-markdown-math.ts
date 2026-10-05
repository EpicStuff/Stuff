import { MarkdownRenderer, MarkdownRenderOptions } from '@theia/core/lib/browser/markdown-rendering/markdown-renderer';
import { injectable, interfaces } from '@theia/core/shared/inversify';
import {
	allowedMarkdownHtmlAttributes,
	allowedMarkdownHtmlTags,
	MarkdownRenderOptions as MonacoMarkdownRenderOptions
} from '@theia/monaco-editor-core/esm/vs/base/browser/markdownRenderer';
import type * as marked from '@theia/monaco-editor-core/esm/vs/base/common/marked/marked';
import { MonacoMarkdownRenderer } from '@theia/monaco/lib/browser/markdown-renderer/monaco-markdown-renderer';
import {
	createNotebookEditorWidgetContainer,
	NotebookEditorProps,
	NotebookEditorWidget,
	NotebookEditorWidgetContainerFactory
} from '@theia/notebook/lib/browser/notebook-editor-widget';
import * as katex from 'katex';
import 'katex/dist/katex.min.css';

interface KatexToken extends marked.Tokens.Generic {
	text: string;
	displayMode: boolean;
}

const INLINE_MATH_PATTERN = /(?<![a-zA-Z0-9])(?<dollars>\${1,2})(?!\.|\(["'])((?:\\.|[^\\\n])*?(?:\\.|[^\\\n\$]))\k<dollars>(?![a-zA-Z0-9])/;
const INLINE_MATH_RULE = new RegExp('^' + INLINE_MATH_PATTERN.source);
const BLOCK_MATH_RULE = /^(\${1,2})\n((?:\\[^]|[^\\])+?)\n\1(?:\n|$)/;

const KATEX_TAGS = [
	'semantics',
	'annotation',
	'math',
	'menclose',
	'merror',
	'mfenced',
	'mfrac',
	'mglyph',
	'mi',
	'mlabeledtr',
	'mmultiscripts',
	'mn',
	'mo',
	'mover',
	'mpadded',
	'mphantom',
	'mroot',
	'mrow',
	'ms',
	'mspace',
	'msqrt',
	'mstyle',
	'msub',
	'msup',
	'msubsup',
	'mtable',
	'mtd',
	'mtext',
	'mtr',
	'munder',
	'munderover',
	'mprescripts',
	'svg',
	'altglyph',
	'altglyphdef',
	'altglyphitem',
	'circle',
	'clippath',
	'defs',
	'desc',
	'ellipse',
	'filter',
	'font',
	'g',
	'glyph',
	'glyphref',
	'hkern',
	'line',
	'lineargradient',
	'marker',
	'mask',
	'metadata',
	'mpath',
	'path',
	'pattern',
	'polygon',
	'polyline',
	'radialgradient',
	'rect',
	'stop',
	'style',
	'switch',
	'symbol',
	'text',
	'textpath',
	'title',
	'tref',
	'tspan',
	'view',
	'vkern'
];

const KATEX_STYLE_PROPERTIES = new Set([
	'display',
	'position',
	'font-family',
	'font-style',
	'font-weight',
	'font-size',
	'height',
	'min-height',
	'max-height',
	'width',
	'min-width',
	'max-width',
	'margin',
	'margin-top',
	'margin-right',
	'margin-bottom',
	'margin-left',
	'padding',
	'padding-top',
	'padding-right',
	'padding-bottom',
	'padding-left',
	'top',
	'left',
	'right',
	'bottom',
	'vertical-align',
	'transform',
	'border',
	'border-top-width',
	'border-right-width',
	'border-bottom-width',
	'border-left-width',
	'color',
	'white-space',
	'text-align',
	'line-height',
	'float',
	'clear'
]);

const KATEX_MACROS: Record<string, string> = {};
const KATEX_EXTENSION = createKatexExtension();
const KATEX_SANITIZER_CONFIG: MonacoMarkdownRenderOptions['sanitizerConfig'] = {
	allowedTags: {
		override: [...allowedMarkdownHtmlTags, ...KATEX_TAGS]
	},
	allowedAttributes: {
		override: [
			...allowedMarkdownHtmlAttributes,
			'stretchy',
			'encoding',
			'accent',
			'd',
			'viewBox',
			'preserveAspectRatio',
			'class',
			{
				attributeName: 'style',
				shouldKeep: (_element, data) => sanitizeKatexStyles(data.attrValue)
			}
		]
	}
};

function createKatexExtension(): marked.MarkedExtension {
	return {
		extensions: [
			createInlineKatexExtension(createKatexRenderer(false)),
			createBlockKatexExtension(createKatexRenderer(true))
		]
	};
}

function createKatexRenderer(block: boolean): marked.RendererExtensionFunction {
	return token => {
		const katexToken = token as KatexToken;
		try {
			const html = katex.renderToString(katexToken.text, {
				displayMode: katexToken.displayMode,
				globalGroup: true,
				macros: KATEX_MACROS,
				throwOnError: true
			});
			return html + (block ? '\n' : '');
		} catch {
			return katexToken.raw + (block ? '\n' : '');
		}
	};
}

function createInlineKatexExtension(renderer: marked.RendererExtensionFunction): marked.TokenizerAndRendererExtension {
	return {
		name: 'inlineKatex',
		level: 'inline',
		start(source: string) {
			let offset = 0;
			let remaining = source;

			while (remaining) {
				const index = remaining.indexOf('$');
				if (index === -1) {
					return;
				}

				if (INLINE_MATH_RULE.test(remaining.substring(index))) {
					return offset + index;
				}

				const consumed = index + 1;
				offset += consumed;
				remaining = remaining.substring(consumed).replace(/^\$+/, '');
			}
			return;
		},
		tokenizer(source: string) {
			const match = source.match(INLINE_MATH_RULE);
			if (!match) {
				return;
			}
			return {
				type: 'inlineKatex',
				raw: match[0],
				text: match[2].trim(),
				displayMode: match[1].length === 2
			};
		},
		renderer
	};
}

function createBlockKatexExtension(renderer: marked.RendererExtensionFunction): marked.TokenizerAndRendererExtension {
	return {
		name: 'blockKatex',
		level: 'block',
		start(source: string) {
			return source.match(new RegExp(BLOCK_MATH_RULE.source, 'm'))?.index;
		},
		tokenizer(source: string) {
			const match = source.match(BLOCK_MATH_RULE);
			if (!match) {
				return;
			}
			return {
				type: 'blockKatex',
				raw: match[0],
				text: match[2].trim(),
				displayMode: true
			};
		},
		renderer
	};
}

function sanitizeKatexStyles(styleText: string): string {
	const style = document.createElement('span').style;
	style.cssText = styleText;
	const safe: string[] = [];

	for (let index = 0; index < style.length; index++) {
		const property = style.item(index);
		if (!KATEX_STYLE_PROPERTIES.has(property)) {
			continue;
		}
		const value = style.getPropertyValue(property);
		if (/^(([\d.\-]+\w*\s?)+|\w+)$/.test(value)) {
			safe.push(`${property}: ${value}`);
		}
	}

	return safe.join('; ');
}

@injectable()
export class NotebookMathMarkdownRenderer extends MonacoMarkdownRenderer {
	protected override transformOptions(options?: MarkdownRenderOptions): MonacoMarkdownRenderOptions {
		const transformed = super.transformOptions(options) ?? {};
		return {
			...transformed,
			markedExtensions: [...(transformed.markedExtensions ?? []), KATEX_EXTENSION],
			sanitizerConfig: KATEX_SANITIZER_CONFIG
		};
	}
}

export function rebindNotebookMarkdownMath(rebind: interfaces.Rebind): void {
	rebind(NotebookEditorWidgetContainerFactory).toFactory(context => (props: NotebookEditorProps) => {
		const child = createNotebookEditorWidgetContainer(context.container, props);
		child.bind(NotebookMathMarkdownRenderer).toSelf().inSingletonScope();
		child.bind(MarkdownRenderer).toService(NotebookMathMarkdownRenderer);
		return child.get(NotebookEditorWidget);
	});
}
