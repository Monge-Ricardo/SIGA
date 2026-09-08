import json

with open('scripts/seed_normalizado.json', encoding='utf-8') as f:
    d = json.load(f)

print('Socios with >1 medidor:')
for s in d['socios']:
    meds = [m for m in d['medidores'] if m['id_socio'] == s['id']]
    if len(meds) > 1:
        print(f"  {s['codigo_socio']} - {s['nombres']} {s['apellidos']} ({s['cedula_ruc']}): {len(meds)} medidores:")
        for m in meds:
            print(f"    Medidor: {m['numero_medidor']} (Alias: {m['alias']}, Alc: {m['tiene_alcantarillado']}, Deuda: {m['deuda_pendiente']}, Lec: {m['lectura_inicial']})")

patricia = [s for s in d['socios'] if 'Patricia' in s['nombres']][0]
print(f"\nPatricia Flores:")
print(f"  {patricia['codigo_socio']} - {patricia['nombres']} {patricia['apellidos']} ({patricia['cedula_ruc']})")
meds_p = [m for m in d['medidores'] if m['id_socio'] == patricia['id']]
print(f"  Medidores: {[m['numero_medidor'] for m in meds_p]}")

aracely = [s for s in d['socios'] if 'Aracely' in s['nombres']][0]
print(f"\nAracely Flores:")
print(f"  {aracely['codigo_socio']} - {aracely['nombres']} {aracely['apellidos']} ({aracely['cedula_ruc']})")
meds_a = [m for m in d['medidores'] if m['id_socio'] == aracely['id']]
print(f"  Medidores: {[m['numero_medidor'] for m in meds_a]}")
