import prisma from '../src/db/client';
import { encrypt, isEncrypted } from '../src/utils/encryption';

async function main() {
  const locations = await prisma.location.findMany({
    where: {
      OR: [
        { squareAccessToken: { not: null } },
        { cloverApiToken: { not: null } },
      ],
    },
  });

  let updated = 0;
  let skipped = 0;

  for (const location of locations) {
    const updates: Record<string, string> = {};

    if (location.squareAccessToken && !isEncrypted(location.squareAccessToken)) {
      updates.squareAccessToken = encrypt(location.squareAccessToken);
      console.log(`[encrypt] location ${location.id}: squareAccessToken encrypted`);
    } else if (location.squareAccessToken) {
      console.log(`[skip]    location ${location.id}: squareAccessToken already encrypted`);
      skipped++;
    }

    if (location.cloverApiToken && !isEncrypted(location.cloverApiToken)) {
      updates.cloverApiToken = encrypt(location.cloverApiToken);
      console.log(`[encrypt] location ${location.id}: cloverApiToken encrypted`);
    } else if (location.cloverApiToken) {
      console.log(`[skip]    location ${location.id}: cloverApiToken already encrypted`);
      skipped++;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.location.update({
        where: { id: location.id },
        data: updates,
      });
      updated++;
    }
  }

  console.log(`\nDone. ${updated} location(s) updated, ${skipped} token(s) already encrypted.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
