import { runTransformIndexTests } from '../../../../test/shared/transforms/index-spec.ts';
import { transformExpressiveCode, transformShikiHighlight } from './index.js';

runTransformIndexTests({ transformExpressiveCode, transformShikiHighlight });
