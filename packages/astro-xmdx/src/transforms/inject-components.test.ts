import { describe, it, expect } from 'bun:test';
import {
  injectComponentImports,
  injectStarlightComponents,
  injectAstroComponents,
  injectComponentImportsFromRegistry,
} from './inject-components.js';
import { createRegistry, starlightLibrary, astroLibrary, type Registry } from 'xmdx/registry';

// Create test registry
const testRegistry = createRegistry([starlightLibrary, astroLibrary]);

const ASTRO_COMPONENTS_MODULE = astroLibrary.defaultModulePath;

describe('injectComponentImports', () => {
  it('should inject missing component imports', () => {
    const code = `
export default function Content() {
  return <Aside>Content</Aside>;
}`;

    const result = injectComponentImports(code, ['Aside'], '@astrojs/starlight/components');

    expect(result).toContain("import { Aside } from '@astrojs/starlight/components';");
    expect(result).toContain('export default');
  });

  it('should not inject imports for unused components', () => {
    const code = `
export default function Content() {
  return <div>No components</div>;
}`;

    const result = injectComponentImports(code, ['Aside', 'Tabs'], '@astrojs/starlight/components');

    expect(result).toBe(code);
    expect(result).not.toContain('import');
  });

  it('should not inject already imported components', () => {
    const code = `
import { Aside } from '@astrojs/starlight/components';

export default function Content() {
  return <Aside>Content</Aside>;
}`;

    const result = injectComponentImports(code, ['Aside'], '@astrojs/starlight/components');

    const importCount = (result.match(/import/g) || []).length;
    expect(importCount).toBe(1);
  });

  it('should inject multiple missing components', () => {
    const code = `
export default function Content() {
  return (
    <>
      <Aside>Note</Aside>
      <Tabs><TabItem>Tab</TabItem></Tabs>
    </>
  );
}`;

    const result = injectComponentImports(
      code,
      ['Aside', 'Tabs', 'TabItem'],
      '@astrojs/starlight/components'
    );

    expect(result).toContain('import { Aside, Tabs, TabItem }');
  });

  it('should only inject components that are used and missing', () => {
    const code = `
import { Aside } from '@astrojs/starlight/components';

export default function Content() {
  return (
    <>
      <Aside>Note</Aside>
      <Tabs>Content</Tabs>
    </>
  );
}`;

    const result = injectComponentImports(
      code,
      ['Aside', 'Tabs', 'Card'],
      '@astrojs/starlight/components'
    );

    // Aside already imported, Tabs is used and missing, Card is not used
    expect(result).toContain('import { Tabs }');
    expect(result).not.toContain('Card');
  });

  it('should detect components with attributes', () => {
    const code = `
export default function Content() {
  return <Aside type="note">Content</Aside>;
}`;

    const result = injectComponentImports(code, ['Aside'], '@astrojs/starlight/components');

    expect(result).toContain('import { Aside }');
  });

  it('should detect self-closing components', () => {
    const code = `
export default function Content() {
  return <Card />;
}`;

    const result = injectComponentImports(code, ['Card'], '@astrojs/starlight/components');

    expect(result).toContain('import { Card }');
  });

  it('should strip heading metadata before scanning', () => {
    const code = `
export const headings = [
  { depth: 1, slug: 'aside', text: 'Aside' }
];

export default function Content() {
  return <Aside>Content</Aside>;
}`;

    const result = injectComponentImports(code, ['Aside'], '@astrojs/starlight/components');

    // Should detect Aside usage in actual content, not in headings
    expect(result).toContain('import { Aside }');
  });

  it('should handle components in nested structures', () => {
    const code = `
export default function Content() {
  return (
    <div>
      <Aside>
        <Tabs>
          <TabItem label="One">Content</TabItem>
        </Tabs>
      </Aside>
    </div>
  );
}`;

    const result = injectComponentImports(
      code,
      ['Aside', 'Tabs', 'TabItem'],
      '@astrojs/starlight/components'
    );

    expect(result).toContain('import { Aside, Tabs, TabItem }');
  });

  it('should not inject if components array is empty', () => {
    const code = `
export default function Content() {
  return <Aside>Content</Aside>;
}`;

    const result = injectComponentImports(code, [], '@astrojs/starlight/components');

    expect(result).toBe(code);
  });
});

describe('injectStarlightComponents', () => {
  it('should inject Starlight components with true config', () => {
    const code = `
export default function Content() {
  return <Aside>Note</Aside>;
}`;

    const result = injectStarlightComponents(code, true);

    expect(result).toContain('import { Aside }');
    expect(result).toContain('@astrojs/starlight/components');
  });

  it('should return code unchanged with false config', () => {
    const code = `
export default function Content() {
  return <Aside>Note</Aside>;
}`;

    const result = injectStarlightComponents(code, false);

    expect(result).toBe(code);
  });

  it('should handle custom components config', () => {
    const code = `
export default function Content() {
  return <CustomAside>Note</CustomAside>;
}`;

    const result = injectStarlightComponents(code, {
      components: ['CustomAside'],
    });

    expect(result).toContain('import { CustomAside }');
  });

  it('should handle custom module config', () => {
    const code = `
export default function Content() {
  return <Aside>Note</Aside>;
}`;

    const result = injectStarlightComponents(code, {
      module: 'my-custom-module',
    });

    expect(result).toContain('import { Aside }');
    expect(result).toContain('my-custom-module');
  });

  it('should inject multiple Starlight components', () => {
    const code = `
export default function Content() {
  return (
    <>
      <Aside>Note</Aside>
      <Tabs><TabItem>Tab</TabItem></Tabs>
      <Steps>
        <li>Step 1</li>
      </Steps>
    </>
  );
}`;

    const result = injectStarlightComponents(code, true);

    expect(result).toContain('import { Aside, Tabs, TabItem, Steps }');
  });
});

describe('injectAstroComponents', () => {
  it('should inject Code component', () => {
    const code = `
export default function Content() {
  return <Code lang="js">const x = 1;</Code>;
}`;

    const result = injectAstroComponents(code);

    expect(result).toContain('import { Code }');
    expect(result).toContain(ASTRO_COMPONENTS_MODULE);
  });

  it('should not inject Prism (not a built-in Astro component)', () => {
    const code = `
export default function Content() {
  return <Prism lang="js">const x = 1;</Prism>;
}`;

    const result = injectAstroComponents(code);

    expect(result).not.toContain('import { Prism }');
    expect(result).toBe(code);
  });

  it('should only inject Code when both Code and Prism are used', () => {
    const code = `
export default function Content() {
  return (
    <>
      <Code lang="js">const x = 1;</Code>
      <Prism lang="python">print("hello")</Prism>
    </>
  );
}`;

    const result = injectAstroComponents(code);

    expect(result).toContain('import { Code }');
    expect(result).not.toContain('import { Code, Prism }');
  });

  it('should not inject if no Astro components used', () => {
    const code = `
export default function Content() {
  return <div>No Astro components</div>;
}`;

    const result = injectAstroComponents(code);

    expect(result).toBe(code);
  });

  it('should not inject if already imported', () => {
    const code = `
import { Code } from 'astro/components';

export default function Content() {
  return <Code lang="js">const x = 1;</Code>;
}`;

    const result = injectAstroComponents(code);

    const importCount = (result.match(/import/g) || []).length;
    expect(importCount).toBe(1);
  });
});

describe('injectComponentImportsFromRegistry', () => {
  it('should inject missing Starlight component imports', () => {
    const code = `
export default function Content() {
  return <Aside>Content</Aside>;
}`;

    const result = injectComponentImportsFromRegistry(code, testRegistry);

    expect(result).toContain("import { Aside } from '@astrojs/starlight/components';");
  });

  it('should inject missing Astro component imports', () => {
    const code = `
export default function Content() {
  return <Code lang="js">const x = 1;</Code>;
}`;

    const result = injectComponentImportsFromRegistry(code, testRegistry);

    expect(result).toContain("import { Code } from 'astro/components';");
  });

  it('should inject components from multiple modules', () => {
    const code = `
export default function Content() {
  return (
    <>
      <Aside>Note</Aside>
      <Code lang="js">code</Code>
    </>
  );
}`;

    const result = injectComponentImportsFromRegistry(code, testRegistry);

    expect(result).toContain("import { Aside } from '@astrojs/starlight/components';");
    expect(result).toContain("import { Code } from 'astro/components';");
  });

  it('should not inject already imported components', () => {
    const code = `
import { Aside } from '@astrojs/starlight/components';

export default function Content() {
  return <Aside>Content</Aside>;
}`;

    const result = injectComponentImportsFromRegistry(code, testRegistry);

    const importCount = (result.match(/import.*Aside/g) || []).length;
    expect(importCount).toBe(1);
  });

  it('should return code unchanged if no registry provided', () => {
    const code = `
export default function Content() {
  return <Aside>Content</Aside>;
}`;

    const result = injectComponentImportsFromRegistry(code, null as unknown as Registry);

    expect(result).toBe(code);
  });

  it('should group multiple components from same module', () => {
    const code = `
export default function Content() {
  return (
    <>
      <Aside>Note</Aside>
      <Tabs><TabItem>Tab</TabItem></Tabs>
    </>
  );
}`;

    const result = injectComponentImportsFromRegistry(code, testRegistry);

    // Should have grouped import
    expect(result).toContain("import { Aside, Tabs, TabItem } from '@astrojs/starlight/components';");
  });

  it('should strip heading metadata before scanning', () => {
    const code = `
export const headings = [
  { depth: 1, slug: 'aside', text: 'Aside' }
];

export default function Content() {
  return <Aside>Content</Aside>;
}`;

    const result = injectComponentImportsFromRegistry(code, testRegistry);

    expect(result).toContain('import { Aside }');
  });
});
