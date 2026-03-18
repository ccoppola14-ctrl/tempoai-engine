// Seed realistic orders mapped to real Square catalog items
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { PrismaClient } = require('@prisma/client');
const adapter = new PrismaBetterSqlite3({ url: 'file:./prisma/dev.db' });
const prisma = new PrismaClient({ adapter });

// Realistic prices and categories for the 34 Square items
const ITEM_DATA = {
  'Mozzarella Sticks': { price: 999, category: 'Appetizers' },
  'Loaded Nachos': { price: 1299, category: 'Appetizers' },
  'Buffalo Wings': { price: 1399, category: 'Appetizers' },
  'Bruschetta': { price: 1099, category: 'Appetizers' },
  'Calamari': { price: 1199, category: 'Appetizers' },
  'Spinach Artichoke Dip': { price: 1099, category: 'Appetizers' },
  'Grilled Salmon': { price: 2399, category: 'Entrees' },
  'NY Strip Steak': { price: 2999, category: 'Entrees' },
  'Chicken Alfredo': { price: 1799, category: 'Entrees' },
  'Fish Tacos': { price: 1599, category: 'Entrees' },
  'Classic Burger': { price: 1499, category: 'Entrees' },
  'BBQ Ribs': { price: 2299, category: 'Entrees' },
  'Shrimp Scampi': { price: 2099, category: 'Entrees' },
  'Veggie Stir Fry': { price: 1499, category: 'Entrees' },
  'Caesar Salad': { price: 1299, category: 'Salads' },
  'Garden Salad': { price: 1099, category: 'Salads' },
  'Tomato Basil Soup': { price: 899, category: 'Soups' },
  'Chicken Noodle Soup': { price: 899, category: 'Soups' },
  'Clam Chowder': { price: 1099, category: 'Soups' },
  'French Fries': { price: 599, category: 'Sides' },
  'Mac & Cheese': { price: 799, category: 'Sides' },
  'Coleslaw': { price: 499, category: 'Sides' },
  'Sweet Potato Fries': { price: 699, category: 'Sides' },
  'Iced Tea': { price: 349, category: 'Drinks' },
  'Lemonade': { price: 449, category: 'Drinks' },
  'Coffee': { price: 349, category: 'Drinks' },
  'Cappuccino': { price: 549, category: 'Drinks' },
  'Smoothie': { price: 749, category: 'Drinks' },
  'Hot Chocolate': { price: 449, category: 'Drinks' },
  'Chocolate Brownie': { price: 899, category: 'Desserts' },
  'Cheesecake': { price: 999, category: 'Desserts' },
  'Ice Cream Sundae': { price: 799, category: 'Desserts' },
  'Key Lime Pie': { price: 899, category: 'Desserts' },
  'Churros': { price: 699, category: 'Desserts' },
};

// Weather patterns for Tampa over 90 days (Dec-Mar)
function getWeather(date) {
  const month = date.getMonth();
  const hour = date.getHours();
  let baseTemp;
  if (month === 11) baseTemp = 72; // Dec
  else if (month === 0) baseTemp = 68; // Jan  
  else if (month === 1) baseTemp = 71; // Feb
  else baseTemp = 76; // Mar
  
  // Time of day variation
  if (hour < 8) baseTemp -= 8;
  else if (hour < 11) baseTemp -= 3;
  else if (hour > 18) baseTemp -= 5;
  else if (hour > 14) baseTemp += 5;
  
  // Random variation
  baseTemp += (Math.random() - 0.5) * 12;
  
  const isRainy = Math.random() < 0.25;
  const codes = isRainy ? [61, 63, 65, 80] : [0, 1, 2, 3, 45];
  const code = codes[Math.floor(Math.random() * codes.length)];
  
  return { temp: Math.round(baseTemp * 10) / 10, isRainy, code };
}

// Daypart definitions
function getDaypart(hour) {
  if (hour >= 6 && hour < 10) return 'breakfast';
  if (hour >= 10 && hour < 14) return 'lunch';
  if (hour >= 14 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'dinner';
  return 'late_night';
}

// Order volume by daypart and day of week
function getOrderVolume(daypart, dayOfWeek, isRainy) {
  const base = {
    breakfast: 15, lunch: 35, afternoon: 10, dinner: 40, late_night: 8
  };
  let vol = base[daypart] || 10;
  
  // Weekend boost
  if (dayOfWeek === 0 || dayOfWeek === 6) vol *= 1.3;
  // Friday dinner boost
  if (dayOfWeek === 5 && daypart === 'dinner') vol *= 1.5;
  // Rain reduces traffic slightly
  if (isRainy) vol *= 0.85;
  // Random variation
  vol *= 0.7 + Math.random() * 0.6;
  
  return Math.round(vol);
}

// Item selection probabilities based on conditions
function selectItems(items, weather, daypart) {
  const selected = [];
  const numItems = 1 + Math.floor(Math.random() * 4); // 1-4 items per order
  
  const weights = items.map(item => {
    let w = 1;
    const name = item.name.toLowerCase();
    const cat = item.category;
    
    // Hot weather: boost cold drinks, salads
    if (weather.temp > 82) {
      if (name.includes('iced tea') || name.includes('lemonade') || name.includes('smoothie')) w *= 3.5;
      if (cat === 'Salads') w *= 2;
      if (name.includes('soup') || name.includes('hot chocolate')) w *= 0.2;
    }
    // Cold weather: boost soups, hot drinks
    if (weather.temp < 65) {
      if (cat === 'Soups') w *= 3;
      if (name.includes('coffee') || name.includes('cappuccino') || name.includes('hot chocolate')) w *= 2.5;
      if (name.includes('iced') || name.includes('smoothie')) w *= 0.3;
    }
    // Rainy: boost comfort food
    if (weather.isRainy) {
      if (cat === 'Soups') w *= 2.5;
      if (name.includes('mac') || name.includes('brownie') || name.includes('ribs')) w *= 1.8;
    }
    // Breakfast items
    if (daypart === 'breakfast') {
      if (name.includes('coffee') || name.includes('cappuccino')) w *= 4;
      if (cat === 'Entrees') w *= 0.3;
      if (cat === 'Desserts') w *= 0.5;
    }
    // Lunch: salads, lighter items
    if (daypart === 'lunch') {
      if (cat === 'Salads') w *= 2;
      if (name.includes('burger') || name.includes('tacos')) w *= 1.5;
    }
    // Dinner: entrees, appetizers
    if (daypart === 'dinner') {
      if (cat === 'Entrees') w *= 2;
      if (cat === 'Appetizers') w *= 1.5;
      if (cat === 'Desserts') w *= 1.5;
      if (name.includes('steak') || name.includes('salmon') || name.includes('ribs')) w *= 1.8;
    }
    // Friday/Saturday night: premium items + desserts
    if (daypart === 'dinner' && (new Date().getDay() === 5 || new Date().getDay() === 6)) {
      if (name.includes('steak') || name.includes('salmon') || name.includes('scampi')) w *= 1.5;
      if (cat === 'Desserts') w *= 1.3;
    }
    
    return w;
  });
  
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  
  for (let i = 0; i < numItems; i++) {
    let r = Math.random() * totalWeight;
    for (let j = 0; j < items.length; j++) {
      r -= weights[j];
      if (r <= 0) {
        const qty = Math.random() < 0.15 ? 2 : 1; // 15% chance of qty 2
        selected.push({ item: items[j], quantity: qty });
        break;
      }
    }
  }
  
  return selected;
}

async function main() {
  console.log('🌱 Seeding realistic orders for Square catalog items...\n');
  
  const location = await prisma.location.findFirst();
  if (!location) {
    console.error('No location found. Run full-sync first.');
    process.exit(1);
  }
  console.log(`📍 Location: ${location.name} (${location.id})`);
  
  // Fix prices and categories
  const items = await prisma.menuItem.findMany({ where: { locationId: location.id } });
  console.log(`📦 Fixing ${items.length} menu items...`);
  
  for (const item of items) {
    const data = ITEM_DATA[item.name];
    if (data) {
      await prisma.menuItem.update({
        where: { id: item.id },
        data: { price: data.price, category: data.category }
      });
    }
  }
  
  // Reload items with fixed data
  const fixedItems = await prisma.menuItem.findMany({ where: { locationId: location.id } });
  console.log('✅ Menu items fixed\n');
  
  // Clear existing orders and weather
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.weatherSnapshot.deleteMany({});
  await prisma.aIPattern.deleteMany({});
  await prisma.recommendation.deleteMany({});
  
  // Generate 90 days of data
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 90);
  
  let totalOrders = 0;
  let totalWeather = 0;
  
  for (let day = 0; day < 90; day++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + day);
    const dayOfWeek = date.getDay();
    const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dayOfWeek];
    
    // Generate orders for each daypart
    const dayparts = [
      { name: 'breakfast', startHour: 7, endHour: 10 },
      { name: 'lunch', startHour: 11, endHour: 14 },
      { name: 'afternoon', startHour: 14, endHour: 17 },
      { name: 'dinner', startHour: 17, endHour: 21 },
      { name: 'late_night', startHour: 21, endHour: 23 },
    ];
    
    let dayOrders = 0;
    
    for (const dp of dayparts) {
      const orderDate = new Date(date);
      orderDate.setHours(Math.floor((dp.startHour + dp.endHour) / 2));
      
      const weather = getWeather(orderDate);
      
      // Save weather snapshot (one per daypart)
      await prisma.weatherSnapshot.create({
        data: {
          locationId: location.id,
          temperature: weather.temp,
          humidity: 50 + Math.random() * 40,
          windSpeed: Math.random() * 20,
          precipitation: weather.isRainy ? Math.random() * 10 : 0,
          conditions: weather.isRainy ? 'rainy' : weather.temp > 85 ? 'hot' : weather.temp < 60 ? 'cold' : 'clear',
          timestamp: orderDate,
        }
      });
      totalWeather++;
      
      const numOrders = getOrderVolume(dp.name, dayOfWeek, weather.isRainy);
      
      for (let o = 0; o < numOrders; o++) {
        const orderTime = new Date(date);
        const hour = dp.startHour + Math.random() * (dp.endHour - dp.startHour);
        orderTime.setHours(Math.floor(hour), Math.floor(Math.random() * 60));
        
        const selectedItems = selectItems(fixedItems, weather, dp.name);
        const totalAmount = selectedItems.reduce((sum, s) => sum + s.item.price * s.quantity, 0);
        
        const order = await prisma.order.create({
          data: {
            locationId: location.id,
            squareOrderId: `sim-${day}-${dp.name}-${o}`,
            total: totalAmount / 100, // convert cents to dollars
            itemCount: selectedItems.reduce((sum, s) => sum + s.quantity, 0),
            timestamp: orderTime,
            orderItems: {
              create: selectedItems.map(s => ({
                menuItemId: s.item.id,
                quantity: s.quantity,
                amount: (s.item.price * s.quantity) / 100,
              }))
            }
          }
        });
        totalOrders++;
      }
      dayOrders += numOrders;
    }
    
    if (day % 10 === 0) {
      console.log(`  Day ${day + 1}/90 (${dayName} ${date.toISOString().split('T')[0]}): ${dayOrders} orders`);
    }
  }
  
  console.log(`\n✅ Created ${totalOrders} orders`);
  console.log(`✅ Created ${totalWeather} weather snapshots`);
  
  // Now run AI analysis
  console.log('\n🧠 Running AI analysis...');
  
  // Import and run engine
  const { analyzeLocation } = require('../src/ai/engine');
  const result = await analyzeLocation(location.id);
  console.log(`✅ AI found ${result.patternsFound} patterns`);
  console.log(`✅ Generated ${result.recommendationsGenerated} recommendations`);
  
  // Show top 5 recommendations
  const recs = await prisma.recommendation.findMany({
    where: { locationId: location.id },
    orderBy: { expectedLift: 'desc' },
    take: 10,
    include: { menuItem: true }
  });
  
  console.log('\n🔥 Top 10 AI Recommendations:');
  recs.forEach((r, i) => {
    console.log(`  ${i+1}. ${r.message} (${r.triggerType}: ${r.triggerCondition}, +${r.expectedLift}% lift, ${r.dataPoints} data points)`);
  });
}

main()
  .catch(e => { console.error('Error:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
