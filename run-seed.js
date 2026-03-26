const { seedDemoOrganization, clearDemoData, getDemoStatus } = require('./dist/src/db/demo-seed.js');
const { getBrandConfig } = require('./dist/src/db/demo-brands/index.js');

const action = process.argv[2] || 'seed';

async function main() {
  if (action === 'clear') {
    console.log('Clearing demo data...');
    const result = await clearDemoData();
    console.log('Clear result:', JSON.stringify(result));
  } else if (action === 'status') {
    const result = await getDemoStatus();
    console.log('Demo status:', JSON.stringify(result, null, 2));
  } else if (action === 'seed') {
    const config = getBrandConfig('lees-donuts');
    if (!config) {
      console.error('Brand not found');
      process.exit(1);
    }
    console.log('Seeding demo data for:', config.brandName);
    console.log('Locations:', config.locations.length);
    console.log('Menu items:', config.menuItems.length);
    const start = Date.now();
    const result = await seedDemoOrganization(config);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\nDone in ${elapsed}s!`);
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
