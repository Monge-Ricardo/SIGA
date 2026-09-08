import fs from 'node:fs';

const envContent = fs.readFileSync('apps/server/.env', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
});

const url = env.SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
console.log('Supabase URL:', url);

async function check() {
  const res = await fetch(url + '/rest/v1/socios?select=id,codigo_socio,nombres,apellidos,medidor_numero', {
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key
    }
  });
  const data = await res.json();
  console.log('Supabase socios count:', data.length);
  console.log('Last 5 from Supabase:', data.slice(-5));

  const resMed = await fetch(url + '/rest/v1/medidores?select=id,numero_medidor,id_socio', {
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key
    }
  });
  const medData = await resMed.json();
  console.log('Supabase medidores count:', medData.length);
  console.log('Last 5 medidores:', medData.slice(-5));
}
check().catch(console.error);
