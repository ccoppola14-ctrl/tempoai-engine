const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const password = 'TestPass123!';
  const hash = await bcrypt.hash(password, 12);
  console.log('Generated hash:', hash);
  
  // Update user A
  const userA = await prisma.user.update({
    where: { email: 'testorga_runtime@tempoai.com' },
    data: { passwordHash: hash }
  });
  console.log('Updated User A:', userA.id);
  
  // Update user B
  const userB = await prisma.user.update({
    where: { email: 'testorgb_runtime@tempoai.com' },
    data: { passwordHash: hash }
  });
  console.log('Updated User B:', userB.id);
  
  // Verify login works
  const testUser = await prisma.user.findUnique({
    where: { email: 'testorga_runtime@tempoai.com' }
  });
  
  const valid = await bcrypt.compare(password, testUser.passwordHash);
  console.log('Password verification:', valid);
  
  await prisma.$disconnect();
}

main().catch(console.error);
