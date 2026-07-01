import { PptMasterService } from './src/ppt-master-service.js';
import { mkdirSync, writeFileSync } from 'fs';
import * as path from 'path';

async function main() {
  const s = new PptMasterService();

  // 1. Test convert_to_markdown with HTML file
  console.log('=== Test convert_to_markdown (HTML→MD) ===');
  const mdResult = await s.convertToMarkdown({ source: 'sample.html', sourceType: 'doc' });
  console.log(JSON.stringify(mdResult, null, 2));

  // 2. Test generate_presentation prepare mode
  console.log('\n=== Test generate_presentation (prepare) ===');
  const prepResult = await s.generatePresentation({
    markdownContent: '# Test Presentation\n\nHello World\n\n## Slide 2\n\nContent here',
    projectName: 'test_ppt',
    outputDir: '/tmp/ppt-master-e2e',
  });
  console.log(JSON.stringify(prepResult, null, 2));

  // 3. Add SVGs and test export
  if (prepResult.success && prepResult.projectDir) {
    console.log('\n=== Test generate_presentation (export) ===');
    const svgDir = path.join(prepResult.projectDir, 'svg_output');
    mkdirSync(svgDir, { recursive: true });
    writeFileSync(
      path.join(svgDir, '01_slide.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="white"/><text x="100" y="100" font-size="48" font-family="Arial">Hello World</text></svg>'
    );
    writeFileSync(
      path.join(svgDir, '02_slide.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="white"/><text x="100" y="200" font-size="48" font-family="Arial">Slide 2</text></svg>'
    );

    const exportResult = await s.generatePresentation({ projectDir: prepResult.projectDir });
    console.log(JSON.stringify(exportResult, null, 2));
  }

  console.log('\n=== All tests passed ===');
}

main().catch(e => { console.error(e); process.exit(1); });