require("dotenv").config({ quiet: true });
const { Pool } = require("pg");

// Neon needs SSL; a local Postgres (e.g. Docker) usually does not.
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

// Thêm sự kiện để bắt lỗi kết nối nếu có trục trặc mạng
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};