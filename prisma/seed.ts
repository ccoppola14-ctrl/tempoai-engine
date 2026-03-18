import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const dbPath = (process.env.DATABASE_URL || 'file:./prisma/dev.db').replace('file:', '');
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

// ─── Seeded random for reproducibility ───────────────────
let _seed = 42;
function seededRandom(): number {
  _seed = (_seed * 16807 + 0) % 2147483647;
  return (_seed - 1) / 2147483646;
}

function randomBetween(min: number, max: number): number {
  return min + seededRandom() * (max - min);
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(seededRandom() * arr.length)];
}

// ─── Menu items ──────────────────────────────────────────
interface MenuItemDef {
  name: string;
  category: string;
  price: number;
  // Bias factors for realistic patterns
  hotWeatherBoost?: number; // multiplier when temp > 85
  coldWeatherBoost?: number; // multiplier when temp < 60
  rainBoost?: number; // multiplier during rain
  breakfastBoost?: number; // multiplier during breakfast
  lunchBoost?: number;
  dinnerBoost?: number;
  weekendBoost?: number;
}

const MENU_ITEMS: MenuItemDef[] = [
  // Hot drinks
  { name: 'Drip Coffee', category: 'Hot Drinks', price: 2.99, breakfastBoost: 2.5, coldWeatherBoost: 1.8, hotWeatherBoost: 0.5 },
  { name: 'Cappuccino', category: 'Hot Drinks', price: 4.49, breakfastBoost: 2.0, coldWeatherBoost: 1.6 },
  { name: 'Latte', category: 'Hot Drinks', price: 4.99, breakfastBoost: 1.8, coldWeatherBoost: 1.5 },
  { name: 'Hot Chocolate', category: 'Hot Drinks', price: 3.99, coldWeatherBoost: 2.5, hotWeatherBoost: 0.2, rainBoost: 1.8 },
  { name: 'Chai Tea Latte', category: 'Hot Drinks', price: 4.49, coldWeatherBoost: 1.7, breakfastBoost: 1.4 },
  { name: 'Espresso', category: 'Hot Drinks', price: 2.49, breakfastBoost: 2.0 },

  // Cold drinks
  { name: 'Iced Coffee', category: 'Cold Drinks', price: 3.49, hotWeatherBoost: 2.5, coldWeatherBoost: 0.3, lunchBoost: 1.5 },
  { name: 'Iced Latte', category: 'Cold Drinks', price: 5.49, hotWeatherBoost: 2.2, coldWeatherBoost: 0.4 },
  { name: 'Cold Brew', category: 'Cold Drinks', price: 4.99, hotWeatherBoost: 2.0, coldWeatherBoost: 0.5 },
  { name: 'Lemonade', category: 'Cold Drinks', price: 3.49, hotWeatherBoost: 3.0, coldWeatherBoost: 0.2 },
  { name: 'Strawberry Smoothie', category: 'Cold Drinks', price: 5.99, hotWeatherBoost: 2.5, coldWeatherBoost: 0.3 },
  { name: 'Mango Smoothie', category: 'Cold Drinks', price: 5.99, hotWeatherBoost: 2.3, coldWeatherBoost: 0.3 },
  { name: 'Iced Tea', category: 'Cold Drinks', price: 2.99, hotWeatherBoost: 2.0, coldWeatherBoost: 0.4 },

  // Breakfast
  { name: 'Avocado Toast', category: 'Breakfast', price: 8.99, breakfastBoost: 3.0, weekendBoost: 1.5 },
  { name: 'Breakfast Burrito', category: 'Breakfast', price: 9.49, breakfastBoost: 2.8 },
  { name: 'Pancake Stack', category: 'Breakfast', price: 7.99, breakfastBoost: 2.5, weekendBoost: 2.0 },
  { name: 'Egg & Cheese Sandwich', category: 'Breakfast', price: 6.49, breakfastBoost: 3.0 },
  { name: 'Oatmeal Bowl', category: 'Breakfast', price: 5.49, breakfastBoost: 2.0, coldWeatherBoost: 1.5 },
  { name: 'Yogurt Parfait', category: 'Breakfast', price: 5.99, breakfastBoost: 1.8, hotWeatherBoost: 1.3 },
  { name: 'Bagel with Cream Cheese', category: 'Breakfast', price: 4.49, breakfastBoost: 2.5 },

  // Lunch
  { name: 'Caesar Salad', category: 'Salads', price: 10.99, lunchBoost: 2.0, hotWeatherBoost: 1.5 },
  { name: 'Garden Salad', category: 'Salads', price: 8.99, lunchBoost: 1.8, hotWeatherBoost: 1.3 },
  { name: 'Grilled Chicken Sandwich', category: 'Sandwiches', price: 11.49, lunchBoost: 2.2 },
  { name: 'Turkey Club', category: 'Sandwiches', price: 10.99, lunchBoost: 2.0 },
  { name: 'BLT', category: 'Sandwiches', price: 9.49, lunchBoost: 1.8 },
  { name: 'Veggie Wrap', category: 'Sandwiches', price: 9.99, lunchBoost: 1.6, hotWeatherBoost: 1.2 },

  // Soups — big rain/cold weather story
  { name: 'Tomato Soup', category: 'Soups', price: 5.99, coldWeatherBoost: 2.5, rainBoost: 2.8, hotWeatherBoost: 0.2, lunchBoost: 1.5 },
  { name: 'Chicken Noodle Soup', category: 'Soups', price: 6.49, coldWeatherBoost: 2.8, rainBoost: 3.0, hotWeatherBoost: 0.15, lunchBoost: 1.4 },
  { name: 'Clam Chowder', category: 'Soups', price: 7.49, coldWeatherBoost: 2.3, rainBoost: 2.5, hotWeatherBoost: 0.3 },
  { name: 'French Onion Soup', category: 'Soups', price: 7.99, coldWeatherBoost: 2.0, rainBoost: 2.2, hotWeatherBoost: 0.3, dinnerBoost: 1.3 },

  // Dinner / entrees
  { name: 'Grilled Salmon', category: 'Entrees', price: 18.99, dinnerBoost: 2.5, weekendBoost: 1.4 },
  { name: 'Chicken Alfredo', category: 'Entrees', price: 14.99, dinnerBoost: 2.2 },
  { name: 'Steak Frites', category: 'Entrees', price: 22.99, dinnerBoost: 2.8, weekendBoost: 1.6 },
  { name: 'Fish Tacos', category: 'Entrees', price: 12.99, dinnerBoost: 1.8, hotWeatherBoost: 1.3 },
  { name: 'Mushroom Risotto', category: 'Entrees', price: 15.99, dinnerBoost: 2.0, coldWeatherBoost: 1.3 },
  { name: 'Burger & Fries', category: 'Entrees', price: 13.49, lunchBoost: 1.5, dinnerBoost: 1.5 },

  // Sides
  { name: 'French Fries', category: 'Sides', price: 4.49, lunchBoost: 1.3, dinnerBoost: 1.2 },
  { name: 'Sweet Potato Fries', category: 'Sides', price: 5.49, lunchBoost: 1.2 },
  { name: 'Side Salad', category: 'Sides', price: 4.99, lunchBoost: 1.4 },
  { name: 'Mac & Cheese', category: 'Sides', price: 5.99, coldWeatherBoost: 1.5, dinnerBoost: 1.2 },
  { name: 'Coleslaw', category: 'Sides', price: 3.49, hotWeatherBoost: 1.2 },

  // Desserts — afternoon slump story
  { name: 'Chocolate Brownie', category: 'Desserts', price: 4.99, dinnerBoost: 1.3 },
  { name: 'Cheesecake Slice', category: 'Desserts', price: 6.99, dinnerBoost: 1.5, weekendBoost: 1.3 },
  { name: 'Key Lime Pie', category: 'Desserts', price: 5.99, hotWeatherBoost: 1.4, dinnerBoost: 1.2 },
  { name: 'Ice Cream Sundae', category: 'Desserts', price: 5.49, hotWeatherBoost: 2.5, coldWeatherBoost: 0.3 },
  { name: 'Churros', category: 'Desserts', price: 4.99 },
  { name: 'Tiramisu', category: 'Desserts', price: 7.49, dinnerBoost: 1.6 },
  { name: 'Cookie', category: 'Desserts', price: 2.49 },

  // Extras
  { name: 'Sparkling Water', category: 'Beverages', price: 2.49, hotWeatherBoost: 1.5 },
  { name: 'Bottled Water', category: 'Beverages', price: 1.99, hotWeatherBoost: 1.8 },
  { name: 'Orange Juice', category: 'Beverages', price: 3.49, breakfastBoost: 2.0 },
  { name: 'Kombucha', category: 'Beverages', price: 4.99, lunchBoost: 1.3 },
];

// ─── Tampa weather simulation ────────────────────────────
interface WeatherHour {
  temperature: number;
  conditions: string;
  precipitation: number;
  humidity: number;
  windSpeed: number;
}

function simulateTampaWeather(date: Date): WeatherHour {
  const month = date.getMonth(); // 0-11
  const hour = date.getHours();

  // Tampa monthly avg temps (high/low °F)
  const monthlyTemps: [number, number][] = [
    [70, 52], // Jan
    [73, 54], // Feb
    [78, 59], // Mar
    [83, 64], // Apr
    [89, 70], // May
    [91, 75], // Jun
    [92, 76], // Jul
    [92, 76], // Aug
    [90, 74], // Sep
    [85, 68], // Oct
    [79, 60], // Nov
    [73, 54], // Dec
  ];

  const [high, low] = monthlyTemps[month];

  // Diurnal curve — lowest around 6am, highest around 3pm
  const hourFactor = Math.sin(((hour - 6) / 24) * Math.PI * 2) * 0.5 + 0.5;
  const baseTemp = low + (high - low) * Math.max(0, Math.min(1, hourFactor));

  // Add some daily variation
  const dayVariation = (seededRandom() - 0.5) * 10;
  const temperature = Math.round((baseTemp + dayVariation) * 10) / 10;

  // Tampa rainy season: June-September, ~40% chance afternoon rain
  const isRainySeason = month >= 5 && month <= 8;
  const rainChance = isRainySeason ? (hour >= 14 && hour <= 18 ? 0.4 : 0.15) : 0.08;
  const isRaining = seededRandom() < rainChance;

  // Thunderstorm chance during rainy season afternoons
  const isThunderstorm = isRaining && isRainySeason && hour >= 14 && seededRandom() < 0.3;

  let conditions: string;
  let precipitation = 0;

  if (isThunderstorm) {
    conditions = 'thunderstorm';
    precipitation = randomBetween(0.3, 1.2);
  } else if (isRaining) {
    conditions = seededRandom() < 0.4 ? 'drizzle' : 'rain';
    precipitation = conditions === 'drizzle' ? randomBetween(0.01, 0.1) : randomBetween(0.1, 0.5);
  } else if (seededRandom() < 0.3) {
    conditions = 'partly_cloudy';
  } else {
    conditions = 'clear';
  }

  const humidity = isRaining
    ? randomBetween(80, 98)
    : isRainySeason
      ? randomBetween(60, 85)
      : randomBetween(40, 70);

  const windSpeed = isThunderstorm
    ? randomBetween(15, 35)
    : randomBetween(3, 15);

  return {
    temperature,
    conditions,
    precipitation: Math.round(precipitation * 100) / 100,
    humidity: Math.round(humidity),
    windSpeed: Math.round(windSpeed * 10) / 10,
  };
}

// ─── Order generation ────────────────────────────────────
function getItemSalesMultiplier(item: MenuItemDef, weather: WeatherHour, hour: number, dayOfWeek: number): number {
  let multiplier = 1.0;

  // Temperature effects
  if (weather.temperature > 85 && item.hotWeatherBoost) {
    multiplier *= item.hotWeatherBoost;
  } else if (weather.temperature < 60 && item.coldWeatherBoost) {
    multiplier *= item.coldWeatherBoost;
  }

  // Rain effects
  if (['rain', 'drizzle', 'thunderstorm'].includes(weather.conditions) && item.rainBoost) {
    multiplier *= item.rainBoost;
  }

  // Daypart effects
  if (hour >= 7 && hour < 11 && item.breakfastBoost) {
    multiplier *= item.breakfastBoost;
  } else if (hour >= 11 && hour < 14 && item.lunchBoost) {
    multiplier *= item.lunchBoost;
  } else if (hour >= 17 && hour < 21 && item.dinnerBoost) {
    multiplier *= item.dinnerBoost;
  }

  // Weekend boost
  if ((dayOfWeek === 0 || dayOfWeek === 6) && item.weekendBoost) {
    multiplier *= item.weekendBoost;
  }

  return multiplier;
}

function generateOrdersForHour(
  menuItems: Array<{ id: string; def: MenuItemDef }>,
  weather: WeatherHour,
  hour: number,
  dayOfWeek: number
): Array<{ items: Array<{ menuItemId: string; quantity: number; amount: number }>; total: number }> {
  const orders: Array<{ items: Array<{ menuItemId: string; quantity: number; amount: number }>; total: number }> = [];

  // Base order volume by hour
  let baseOrders: number;
  if (hour >= 7 && hour < 9) baseOrders = randomInt(8, 18); // Breakfast rush
  else if (hour >= 9 && hour < 11) baseOrders = randomInt(5, 12);
  else if (hour >= 11 && hour < 14) baseOrders = randomInt(15, 30); // Lunch rush
  else if (hour >= 14 && hour < 17) baseOrders = randomInt(3, 8); // Afternoon lull
  else if (hour >= 17 && hour < 20) baseOrders = randomInt(12, 25); // Dinner
  else if (hour >= 20 && hour < 22) baseOrders = randomInt(4, 10);
  else baseOrders = randomInt(0, 3);

  // Weekend boost
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    baseOrders = Math.round(baseOrders * 1.2);
  }

  // Rain reduces foot traffic slightly
  if (['rain', 'thunderstorm'].includes(weather.conditions)) {
    baseOrders = Math.round(baseOrders * 0.75);
  }

  for (let o = 0; o < baseOrders; o++) {
    const numItems = randomInt(1, 4);
    const orderItems: Array<{ menuItemId: string; quantity: number; amount: number }> = [];
    let total = 0;

    // Weight item selection by multiplier
    const weights = menuItems.map((mi) => ({
      ...mi,
      weight: getItemSalesMultiplier(mi.def, weather, hour, dayOfWeek),
    }));

    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);

    for (let i = 0; i < numItems; i++) {
      // Weighted random selection
      let rand = seededRandom() * totalWeight;
      let selected = weights[0];
      for (const w of weights) {
        rand -= w.weight;
        if (rand <= 0) {
          selected = w;
          break;
        }
      }

      const quantity = seededRandom() < 0.15 ? 2 : 1; // 15% chance of ordering 2
      const amount = selected.def.price * quantity;
      total += amount;

      // Check if already in order
      const existingItem = orderItems.find((oi) => oi.menuItemId === selected.id);
      if (existingItem) {
        existingItem.quantity += quantity;
        existingItem.amount += amount;
      } else {
        orderItems.push({
          menuItemId: selected.id,
          quantity,
          amount: Math.round(amount * 100) / 100,
        });
      }
    }

    orders.push({
      items: orderItems,
      total: Math.round(total * 100) / 100,
    });
  }

  return orders;
}

// ─── Main seed function ──────────────────────────────────
async function seed() {
  console.log('Seeding TempoAi database...');

  // Clear existing data
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.recommendation.deleteMany();
  await prisma.aIPattern.deleteMany();
  await prisma.weatherSnapshot.deleteMany();
  await prisma.syncLog.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.location.deleteMany();
  await prisma.organization.deleteMany();

  console.log('Cleared existing data.');

  // Create organization
  const org = await prisma.organization.create({
    data: {
      id: 'org-tempoai-demo',
      name: 'TempoAi Demo Restaurant Group',
    },
  });

  // Create locations
  const locations = await Promise.all([
    prisma.location.create({
      data: {
        id: 'loc-tampa-downtown',
        organizationId: org.id,
        name: 'Tampa Downtown',
        address: '615 Channelside Dr, Tampa, FL 33602',
        lat: 27.9425,
        lng: -82.4515,
        timezone: 'America/New_York',
        squareMerchantId: 'demo-merchant-downtown',
      },
    }),
    prisma.location.create({
      data: {
        id: 'loc-tampa-westshore',
        organizationId: org.id,
        name: 'Tampa Westshore',
        address: '1548 W Kennedy Blvd, Tampa, FL 33606',
        lat: 27.9461,
        lng: -82.4967,
        timezone: 'America/New_York',
        squareMerchantId: 'demo-merchant-westshore',
      },
    }),
  ]);

  console.log(`Created ${locations.length} locations.`);

  // Create menu items for each location
  const allMenuItems: Array<{ id: string; locationId: string; def: MenuItemDef }> = [];

  for (const location of locations) {
    for (let i = 0; i < MENU_ITEMS.length; i++) {
      const item = MENU_ITEMS[i];
      // Small price variation between locations
      const priceVariation = location.id === 'loc-tampa-westshore' ? 1.05 : 1.0;

      const menuItem = await prisma.menuItem.create({
        data: {
          id: `mi-${location.id.split('-').pop()}-${i}`,
          locationId: location.id,
          squareItemId: `square-item-${i}`,
          name: item.name,
          category: item.category,
          price: Math.round(item.price * priceVariation * 100) / 100,
          active: true,
        },
      });

      allMenuItems.push({ id: menuItem.id, locationId: location.id, def: item });
    }
  }

  console.log(`Created ${allMenuItems.length} menu items.`);

  // Generate 90 days of weather + orders
  const now = new Date();
  const DAYS = 90;
  let totalOrders = 0;
  let totalWeatherSnapshots = 0;

  for (const location of locations) {
    const locationMenuItems = allMenuItems.filter((mi) => mi.locationId === location.id);

    console.log(`Generating data for ${location.name}...`);

    for (let d = DAYS; d >= 0; d--) {
      const date = new Date(now);
      date.setDate(date.getDate() - d);
      date.setHours(0, 0, 0, 0);

      const dayOfWeek = date.getDay();

      // Generate weather snapshots every hour (6am-11pm)
      for (let h = 6; h <= 22; h++) {
        const timestamp = new Date(date);
        timestamp.setHours(h, 0, 0, 0);

        const weather = simulateTampaWeather(timestamp);

        await prisma.weatherSnapshot.create({
          data: {
            locationId: location.id,
            timestamp,
            temperature: weather.temperature,
            conditions: weather.conditions,
            precipitation: weather.precipitation,
            humidity: weather.humidity,
            windSpeed: weather.windSpeed,
          },
        });
        totalWeatherSnapshots++;

        // Generate orders for this hour
        const orders = generateOrdersForHour(locationMenuItems, weather, h, dayOfWeek);

        for (const order of orders) {
          const orderTimestamp = new Date(timestamp);
          orderTimestamp.setMinutes(randomInt(0, 59));

          await prisma.order.create({
            data: {
              locationId: location.id,
              timestamp: orderTimestamp,
              total: order.total,
              itemCount: order.items.reduce((sum, i) => sum + i.quantity, 0),
              orderItems: {
                create: order.items.map((item) => ({
                  menuItemId: item.menuItemId,
                  quantity: item.quantity,
                  amount: item.amount,
                })),
              },
            },
          });
          totalOrders++;
        }
      }
    }

    // Create sync log entries
    await prisma.syncLog.create({
      data: {
        locationId: location.id,
        source: 'seed',
        status: 'success',
        recordsProcessed: totalOrders,
      },
    });
  }

  console.log(`Created ${totalWeatherSnapshots} weather snapshots.`);
  console.log(`Created ${totalOrders} orders.`);

  console.log('\nSeed complete! Run the AI analysis to generate patterns and recommendations.');
  console.log('  POST http://localhost:3001/api/analyze');
  console.log('  Or start the server and it will use the seeded data in demo mode.');
}

seed()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
