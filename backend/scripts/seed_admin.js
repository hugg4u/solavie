const { Client } = require('pg');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

async function seed() {
  const client = new Client({
    user: 'solavie_admin',
    host: 'localhost',
    database: 'solavie_db',
    password: 'solavie_super_secret_db_pass',
    port: 5433,
  });

  try {
    await client.connect();
    console.log('Connected to DB');

    const id = uuidv4();
    const email = 'admin@solavie.vn';
    const fullName = 'Solavie Admin';
    const rawPassword = 'Admin@123';
    
    // Check if exists
    const check = await client.query('SELECT id FROM iam_users WHERE email = $1', [email]);
    if (check.rows.length > 0) {
      console.log('Admin user already exists.');
      return;
    }

    const passwordHash = await bcrypt.hash(rawPassword, 10);

    const query = `
      INSERT INTO iam_users (id, email, full_name, password_hash, is_active, created_at, updated_at) 
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    `;
    await client.query(query, [id, email, fullName, passwordHash, true]);
    console.log('Inserted admin user: admin@solavie.vn / Admin@123');

  } catch (err) {
    console.error('Error seeding:', err);
  } finally {
    await client.end();
  }
}

seed();
