/**
 * Performance example: Parsing with statistics
 */

import { parseWithStats } from '../index.js';

// Different sizes of markdown content to benchmark
const testCases = [
  {
    name: 'Small (1 paragraph)',
    markdown: '# Small\n\nThis is a **small** test case with minimal content.'
  },
  {
    name: 'Medium (10 paragraphs)',
    markdown: '# Medium\n\n' + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(50)
  },
  {
    name: 'Large (100 paragraphs)',
    markdown: '# Large\n\n' + ('## Section\n\nLorem ipsum dolor sit amet. '.repeat(100) + '\n\n').repeat(10)
  }
];

console.log('⚡ Performance Benchmarking with parseWithStats()\n');
console.log('─'.repeat(70));

for (const testCase of testCases) {
  const result = parseWithStats(testCase.markdown);

  console.log(`\n📄 ${testCase.name}`);
  console.log(`  Input size:        ${testCase.markdown.length.toLocaleString()} bytes`);
  console.log(`  Output size:       ${result.html.length.toLocaleString()} bytes`);
  console.log(`  Processing time:   ${result.processingTimeMs.toFixed(3)} ms`);
  console.log(`  Throughput:        ${(testCase.markdown.length / result.processingTimeMs * 1000).toFixed(0).toLocaleString()} bytes/sec`);
}

console.log('\n' + '─'.repeat(70));

// Real-world example
console.log('\n📝 Real-world Example:\n');

const blogPost = `
# Building Fast Web Applications with Rust

## Introduction

Modern web applications demand high performance and low latency. Traditional JavaScript-based
markdown parsers can become bottlenecks when processing large documents.

## Why Rust?

Rust provides:

- **Memory safety** without garbage collection
- **Zero-cost abstractions** for maximum performance
- **Fearless concurrency** for parallel processing

## Performance Results

![Benchmark Results](benchmark.png)

\`\`\`rust
fn parse_markdown(input: &str) -> String {
    // Streaming parser implementation
    markflow_core::parse(input).unwrap()
}
\`\`\`

## Conclusion

By leveraging Rust's performance characteristics, we can build markdown parsers that are
**10x faster** than pure JavaScript implementations.

---

*Published on $(new Date().toISOString().split('T')[0])*
`;

const result = parseWithStats(blogPost);

console.log(`Input:  ${blogPost.length} characters`);
console.log(`Output: ${result.html.length} characters`);
console.log(`Time:   ${result.processingTimeMs.toFixed(3)} ms`);
console.log(`\n✨ Generated HTML preview (first 300 chars):`);
console.log(result.html.slice(0, 300) + '...');
