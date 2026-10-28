// RNP-003: a database client in the browser bundle.
import { Pool } from 'pg';

const pool = new Pool();

export async function countUsers() {
  return (await pool.query('SELECT count(*) FROM app_user')).rows[0].count;
}
