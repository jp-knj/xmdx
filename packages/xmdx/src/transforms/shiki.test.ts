import { runShikiTests } from '../../../../test/shared/transforms/shiki-spec.ts';
import {
  highlightHtmlBlocks,
  highlightJsStringCodeBlocks,
  highlightJsxCodeBlocks,
  rewriteAstroSetHtml,
} from './shiki.js';

runShikiTests({
  highlightHtmlBlocks,
  highlightJsStringCodeBlocks,
  highlightJsxCodeBlocks,
  rewriteAstroSetHtml,
});
