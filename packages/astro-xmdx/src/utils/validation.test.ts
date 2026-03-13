import { runValidationTests } from '../../../../test/shared/utils/validation-spec.ts';
import { stripHeadingsMeta } from 'xmdx/utils/validation';

runValidationTests({ stripHeadingsMeta });
