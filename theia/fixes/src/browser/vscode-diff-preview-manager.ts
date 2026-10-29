import { DiffUris } from '@theia/core/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { injectable } from '@theia/core/shared/inversify';
import { EditorOpenerOptions } from '@theia/editor/lib/browser';
import { EditorPreviewManager } from '@theia/editor-preview/lib/browser/editor-preview-manager';
import { EditorPreviewOptions } from '@theia/editor-preview/lib/browser/editor-preview-widget-factory';
import { diffPreviewOptions } from './diff-preview-options';

/** Match VS Code's default preview behavior for diff editor inputs. */
@injectable()
export class VSCodeDiffPreviewManager extends EditorPreviewManager {
	protected override createWidgetOptions(uri: URI, options?: EditorOpenerOptions): EditorPreviewOptions {
		return super.createWidgetOptions(uri, diffPreviewOptions(DiffUris.isDiffUri(uri), options));
	}
}
