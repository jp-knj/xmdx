import { runValidationTests } from '../../../../test/shared/utils/validation-spec.ts';
import { stripHeadingsMeta } from './validation.js';

runValidationTests({ stripHeadingsMeta });
