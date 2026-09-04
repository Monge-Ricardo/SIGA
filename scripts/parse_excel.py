import pandas as pd
import json
import uuid
import datetime

excel_file = 'normalizacion_datos.xlsx'
df = pd.read_excel(excel_file, sheet_name='Hoja1')

# Sectores mapeo
sectores_map = {
    'paso lateral': {
        'id': '11111111-0000-0000-0000-000000000001',
        'codigo_sector': 'SEC-PASO',
        'nombre_sector': 'Sector Paso Lateral',
        'descripcion': 'Zona paso lateral y vías perimetrales'
    },
    'san jose': {
        'id': '11111111-0000-0000-0000-000000000002',
        'codigo_sector': 'SEC-SANJOSE',
        'nombre_sector': 'Sector San José',
        'descripcion': 'Barrio San José y ramal alto'
    },
    'centro parroquial': {
        'id': '11111111-0000-0000-0000-000000000003',
        'codigo_sector': 'SEC-CENTRO',
        'nombre_sector': 'Sector Centro Parroquial',
        'descripcion': 'Casco central y parque principal'
    },
    'san antonio': {
        'id': '11111111-0000-0000-0000-000000000004',
        'codigo_sector': 'SEC-SANANTONIO',
        'nombre_sector': 'Sector San Antonio',
        'descripcion': 'Barrio San Antonio y zona baja'
    }
}

# Namespace para UUIDs deterministas
NAMESPACE_SIGA = uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')

socios_dict = {}
medidores_list = []
socios_counter = 1

for idx, row in df.iterrows():
    cedula_raw = str(row['cedula_ruc']).strip()
    # Asegurar formato de cédula a 10 dígitos
    cedula = cedula_raw.split('.')[0].zfill(10)
    
    nombres = str(row['nombres']).strip()
    apellidos = str(row['apellidos']).strip()
    
    # Formatear fecha de nacimiento
    fnac_val = row['fecha_nacimiento']
    if isinstance(fnac_val, pd.Timestamp) or isinstance(fnac_val, datetime.date):
        fecha_nacimiento = fnac_val.strftime('%Y-%m-%d')
    else:
        fecha_nacimiento = '1970-01-01'
        
    funion_val = row['fecha_union']
    if isinstance(funion_val, pd.Timestamp) or isinstance(funion_val, datetime.date):
        fecha_union = funion_val.strftime('%Y-%m-%d')
    else:
        fecha_union = '2020-01-01'
        
    tel_raw = str(row['telefono']).strip()
    telefono = tel_raw.split('.')[0] if tel_raw != 'nan' else '0990000000'
    
    sector_name = str(row['sector']).strip().lower()
    sector_info = sectores_map.get(sector_name, sectores_map['centro parroquial'])
    
    dir_raw = str(row['direccion']).strip()
    direccion = dir_raw if dir_raw != 'nan' and dir_raw != '' else f"Sector {sector_info['nombre_sector']}"
    
    # Registrar o recuperar Socio
    if cedula not in socios_dict:
        socio_id = str(uuid.uuid5(NAMESPACE_SIGA, f"socio_{cedula}"))
        codigo_socio = f"SOC-{str(socios_counter).zfill(4)}"
        socios_counter += 1
        
        socios_dict[cedula] = {
            'id': socio_id,
            'codigo_socio': codigo_socio,
            'nombres': nombres,
            'apellidos': apellidos,
            'cedula_ruc': cedula,
            'fecha_nacimiento': fecha_nacimiento,
            'fecha_union': fecha_union,
            'telefono': telefono,
            'direccion': direccion,
            'estado': 'ACTIVO',
            'medidores_count': 0,
            'deuda_total_acumulada': 0.0,
            'meses_adeudados_max': 0,
            'desde_periodo': None
        }
    
    socio = socios_dict[cedula]
    socio['medidores_count'] += 1
    
    # Medidor
    numero_medidor = str(row['numero_medidor']).strip()
    alias_raw = str(row['alias_medidor']).strip()
    if alias_raw != 'nan' and alias_raw != '':
        alias = alias_raw
    else:
        alias = 'Casa principal' if socio['medidores_count'] == 1 else f"Medidor {socio['medidores_count']}"
        
    tiene_alc = str(row['tiene_alcantarillado']).strip().upper() == 'SI'
    
    try:
        lectura_ini = float(row['lectura_inicial'])
    except:
        lectura_ini = 0.0
        
    try:
        deuda_pen = round(float(row['deuda_pendiente']), 2)
    except:
        deuda_pen = 0.0
        
    try:
        meses_ade = int(row['meses_adeudados']) if pd.notna(row['meses_adeudados']) else 0
    except:
        meses_ade = 0
        
    desde_per = str(row['desde_periodo']).strip() if pd.notna(row['desde_periodo']) else None
    
    medidor_id = str(uuid.uuid5(NAMESPACE_SIGA, f"medidor_{numero_medidor}"))
    
    medidor_data = {
        'id': medidor_id,
        'id_socio': socio['id'],
        'id_sector': sector_info['id'],
        'numero_medidor': numero_medidor,
        'alias': alias,
        'direccion': direccion,
        'tiene_alcantarillado': tiene_alc,
        'estado': 'ACTIVO',
        'lectura_inicial': lectura_ini,
        'deuda_pendiente': deuda_pen,
        'meses_adeudados': meses_ade,
        'desde_periodo': desde_per,
        'socio_codigo': socio['codigo_socio'],
        'socio_nombre': f"{socio['nombres']} {socio['apellidos']}",
        'sector_nombre': sector_info['nombre_sector']
    }
    medidores_list.append(medidor_data)
    
    socio['deuda_total_acumulada'] = round(socio['deuda_total_acumulada'] + deuda_pen, 2)
    if meses_ade > socio['meses_adeudados_max']:
        socio['meses_adeudados_max'] = meses_ade
    if desde_per and not socio['desde_periodo']:
        socio['desde_periodo'] = desde_per

result = {
    'sectores': list(sectores_map.values()),
    'socios': list(socios_dict.values()),
    'medidores': medidores_list
}

with open('scripts/migracion_data.json', 'w', encoding='utf-8') as f:
    json.dump(result, f, indent=2, ensure_ascii=False)

print(f"✅ Extracción completada exitosamente:")
print(f" - Sectores: {len(result['sectores'])}")
print(f" - Socios únicos: {len(result['socios'])}")
print(f" - Medidores acometidas: {len(result['medidores'])}")
print(f" - Total deuda migrada: ${sum(s['deuda_total_acumulada'] for s in result['socios']):.2f}")
