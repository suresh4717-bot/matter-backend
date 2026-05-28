const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Your Supabase connection string (update with your actual password)
// Get this from: Supabase Dashboard → Settings → Database → Connection string
const DATABASE_URL = 'postgresql://postgres:YOUR_PASSWORD_HERE@db.lsvxhairsuuiukomuvnh.supabase.co:5432/postgres';

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function migrate() {
  console.log('\n🚀 Starting Database Migration...\n');

  // Check if DATABASE_URL has placeholder
  if (DATABASE_URL.includes('YOUR_PASSWORD_HERE')) {
    console.error('❌ Please update DATABASE_URL with your actual Supabase password in migrate.js');
    console.log('\n📍 How to get your password:');
    console.log('1. Go to Supabase Dashboard → Settings → Database');
    console.log('2. Copy the "Connection string" (password is already there)');
    console.log('3. Replace YOUR_PASSWORD_HERE in DATABASE_URL\n');
    rl.close();
    return;
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for Supabase
  });

  try {
    console.log('📡 Connecting to Supabase...');
    await client.connect();
    console.log('✅ Connected to Supabase\n');

    // Read schema file
    const schemaPath = path.join(__dirname, '../database/schema.sql');
    
    if (!fs.existsSync(schemaPath)) {
      console.error(`❌ Schema file not found: ${schemaPath}`);
      rl.close();
      return;
    }

    const schema = fs.readFileSync(schemaPath, 'utf8');
    console.log(`📄 Read schema file (${schema.length} characters)\n`);

    // Ask for confirmation
    const answer = await new Promise((resolve) => {
      rl.question('⚠️  This will create/replace tables. Continue? (y/n): ', resolve);
    });

    if (answer.toLowerCase() !== 'y') {
      console.log('\n❌ Migration cancelled.');
      rl.close();
      return;
    }

    console.log('\n🔄 Running migration...\n');

    // Split schema into individual statements
    const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);
    
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i].trim();
      if (!stmt) continue;
      
      try {
        await client.query(stmt);
        successCount++;
        process.stdout.write(`\r✅ Executed ${successCount}/${statements.length} statements`);
      } catch (err) {
        errorCount++;
        console.log(`\n⚠️  Error in statement ${i + 1}: ${err.message}`);
      }
    }

    console.log(`\n\n📊 Migration Summary:`);
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ⚠️  Errors: ${errorCount}`);
    
    if (errorCount === 0) {
      console.log('\n🎉 Database migrated successfully!');
    } else {
      console.log('\n⚠️  Migration completed with some errors. Review them above.');
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
  } finally {
    await client.end();
    rl.close();
  }
}

// Run migration
migrate();