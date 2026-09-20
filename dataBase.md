-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.usuarios (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  username character varying NOT NULL UNIQUE,
  password_hash text NOT NULL,
  nombre_completo character varying NOT NULL,
  rol character varying NOT NULL CHECK (rol::text = ANY (ARRAY['ADMIN'::character varying, 'CAJERO'::character varying, 'LECTOR'::character varying, 'AUDITOR'::character varying]::text[])),
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT usuarios_pkey PRIMARY KEY (id)
);
CREATE TABLE public.sectores (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  codigo_sector character varying NOT NULL UNIQUE,
  nombre_sector character varying NOT NULL,
  descripcion text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sectores_pkey PRIMARY KEY (id)
);
CREATE TABLE public.tarifas_config (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  cargo_fijo_normal numeric NOT NULL DEFAULT 7.00,
  cargo_fijo_tercera_edad numeric NOT NULL DEFAULT 5.00,
  limite_base_m3 numeric NOT NULL DEFAULT 30.00,
  costo_excedente_m3 numeric NOT NULL DEFAULT 0.10,
  recargo_alcantarillado numeric NOT NULL DEFAULT 1.00,
  reparto_normal_padre numeric NOT NULL DEFAULT 2.00,
  reparto_normal_operacion numeric NOT NULL DEFAULT 4.00,
  reparto_normal_lector numeric NOT NULL DEFAULT 0.50,
  reparto_normal_mortuorio numeric NOT NULL DEFAULT 0.50,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tarifas_config_pkey PRIMARY KEY (id)
);
CREATE TABLE public.socios (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  codigo_socio character varying NOT NULL UNIQUE,
  nombres character varying NOT NULL,
  apellidos character varying NOT NULL,
  cedula_ruc character varying NOT NULL UNIQUE,
  fecha_nacimiento date NOT NULL,
  fecha_union date NOT NULL DEFAULT CURRENT_DATE,
  telefono character varying,
  direccion text NOT NULL,
  estado character varying NOT NULL DEFAULT 'ACTIVO'::character varying CHECK (estado::text = ANY (ARRAY['ACTIVO'::character varying, 'SUSPENDIDO'::character varying, 'CORTADO'::character varying]::text[])),
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  -- deuda_alcantarillado: mantenido para compatibilidad transicional y lectura rápida de frontend/móvil.
  -- La cartera granular, abonos y saldos oficiales se gestionan en multas_rubros ('ALCANTARILLADO') y rubros_abonos.
  deuda_alcantarillado numeric NOT NULL DEFAULT 0.00,
  tiene_alcantarillado boolean NOT NULL DEFAULT false,
  CONSTRAINT socios_pkey PRIMARY KEY (id)
);
CREATE TABLE public.medidores (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  id_socio uuid NOT NULL,
  id_sector uuid NOT NULL,
  numero_medidor character varying NOT NULL UNIQUE,
  alias character varying DEFAULT 'Casa principal'::character varying,
  direccion text,
  tiene_alcantarillado boolean NOT NULL DEFAULT false,
  estado character varying NOT NULL DEFAULT 'ACTIVO'::character varying CHECK (estado::text = ANY (ARRAY['ACTIVO'::character varying, 'SUSPENDIDO'::character varying, 'CORTADO'::character varying]::text[])),
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT medidores_pkey PRIMARY KEY (id),
  CONSTRAINT medidores_id_socio_fkey FOREIGN KEY (id_socio) REFERENCES public.socios(id),
  CONSTRAINT medidores_id_sector_fkey FOREIGN KEY (id_sector) REFERENCES public.sectores(id)
);
CREATE TABLE public.periodos (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  periodo_codigo character varying NOT NULL UNIQUE,
  nombre character varying NOT NULL,
  fecha_inicio date NOT NULL,
  fecha_fin date NOT NULL,
  estado character varying NOT NULL DEFAULT 'ABIERTO'::character varying CHECK (estado::text = ANY (ARRAY['ABIERTO'::character varying, 'CERRADO'::character varying, 'FACTURADO'::character varying]::text[])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT periodos_pkey PRIMARY KEY (id)
);
CREATE TABLE public.lecturas (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  id_medidor uuid NOT NULL,
  id_socio uuid NOT NULL,
  id_periodo uuid NOT NULL,
  lectura_anterior numeric NOT NULL,
  lectura_actual numeric NOT NULL,
  consumo_total numeric NOT NULL,
  excedente_m3 numeric NOT NULL,
  fecha_lectura timestamp with time zone NOT NULL DEFAULT now(),
  id_lector uuid NOT NULL,
  observaciones text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lecturas_pkey PRIMARY KEY (id),
  CONSTRAINT lecturas_id_medidor_fkey FOREIGN KEY (id_medidor) REFERENCES public.medidores(id),
  CONSTRAINT lecturas_id_socio_fkey FOREIGN KEY (id_socio) REFERENCES public.socios(id),
  CONSTRAINT lecturas_id_periodo_fkey FOREIGN KEY (id_periodo) REFERENCES public.periodos(id),
  CONSTRAINT lecturas_id_lector_fkey FOREIGN KEY (id_lector) REFERENCES public.usuarios(id)
);
CREATE TABLE public.multas_rubros (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  id_socio uuid NOT NULL,
  id_periodo uuid,
  tipo_rubro character varying NOT NULL CHECK (tipo_rubro::text = ANY (ARRAY['ALCANTARILLADO'::character varying, 'MINGA'::character varying, 'ASAMBLEA'::character varying, 'RECONEXION'::character varying, 'CUOTA_EXTRA'::character varying, 'OTRO'::character varying]::text[])),
  monto numeric NOT NULL,
  monto_pagado numeric NOT NULL DEFAULT 0.00,
  saldo_pendiente numeric NOT NULL DEFAULT 0.00,
  estado character varying NOT NULL DEFAULT 'PENDIENTE'::character varying CHECK (estado::text = ANY (ARRAY['PENDIENTE'::character varying, 'PARCIAL'::character varying, 'PAGADO'::character varying, 'ANULADO'::character varying]::text[])),
  motivo text NOT NULL,
  pagado boolean NOT NULL DEFAULT false,
  id_factura uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT multas_rubros_pkey PRIMARY KEY (id),
  CONSTRAINT multas_rubros_id_socio_fkey FOREIGN KEY (id_socio) REFERENCES public.socios(id),
  CONSTRAINT multas_rubros_id_periodo_fkey FOREIGN KEY (id_periodo) REFERENCES public.periodos(id)
);
CREATE TABLE public.rubros_abonos (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  id_rubro uuid NOT NULL,
  id_factura uuid NOT NULL,
  monto_abonado numeric NOT NULL CHECK (monto_abonado > 0),
  saldo_anterior numeric NOT NULL,
  saldo_restante numeric NOT NULL,
  fecha timestamp with time zone NOT NULL DEFAULT now(),
  id_cajero uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT rubros_abonos_pkey PRIMARY KEY (id),
  CONSTRAINT rubros_abonos_id_rubro_fkey FOREIGN KEY (id_rubro) REFERENCES public.multas_rubros(id) ON DELETE CASCADE,
  CONSTRAINT rubros_abonos_id_factura_fkey FOREIGN KEY (id_factura) REFERENCES public.facturas(id) ON DELETE CASCADE,
  CONSTRAINT rubros_abonos_id_cajero_fkey FOREIGN KEY (id_cajero) REFERENCES public.usuarios(id)
);
CREATE TABLE public.facturas (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  numero_factura character varying NOT NULL UNIQUE,
  id_socio uuid NOT NULL,
  id_medidor uuid,
  id_periodo uuid NOT NULL,
  id_lectura uuid,
  es_tercera_edad boolean NOT NULL DEFAULT false,
  valor_base numeric NOT NULL,
  consumo_m3 numeric NOT NULL,
  excedente_m3 numeric NOT NULL,
  valor_excedente numeric NOT NULL,
  valor_alcantarillado numeric NOT NULL,
  valor_multas numeric NOT NULL DEFAULT 0.00,
  valor_deuda_anterior numeric NOT NULL DEFAULT 0.00,
  total_mes numeric NOT NULL,
  total_pagar numeric NOT NULL,
  estado_pago character varying NOT NULL DEFAULT 'PENDIENTE'::character varying CHECK (estado_pago::text = ANY (ARRAY['PENDIENTE'::character varying, 'PAGADO'::character varying, 'ANULADO'::character varying]::text[])),
  fecha_vencimiento date NOT NULL,
  fecha_pago timestamp with time zone,
  metodo_pago character varying CHECK (metodo_pago::text = ANY (ARRAY['EFECTIVO'::character varying, 'TRANSFERENCIA'::character varying, 'MOVIL'::character varying]::text[])),
  id_cajero uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT facturas_pkey PRIMARY KEY (id),
  CONSTRAINT facturas_id_socio_fkey FOREIGN KEY (id_socio) REFERENCES public.socios(id),
  CONSTRAINT facturas_id_medidor_fkey FOREIGN KEY (id_medidor) REFERENCES public.medidores(id),
  CONSTRAINT facturas_id_periodo_fkey FOREIGN KEY (id_periodo) REFERENCES public.periodos(id),
  CONSTRAINT facturas_id_lectura_fkey FOREIGN KEY (id_lectura) REFERENCES public.lecturas(id),
  CONSTRAINT facturas_id_cajero_fkey FOREIGN KEY (id_cajero) REFERENCES public.usuarios(id)
);
CREATE TABLE public.fondos_catalogo (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  codigo character varying NOT NULL UNIQUE,
  nombre character varying NOT NULL,
  descripcion text,
  activo boolean NOT NULL DEFAULT true,
  CONSTRAINT fondos_catalogo_pkey PRIMARY KEY (id)
);
CREATE TABLE public.fondos_movimientos (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  id_fondo uuid NOT NULL,
  fecha timestamp with time zone NOT NULL DEFAULT now(),
  concepto character varying NOT NULL,
  tipo character varying NOT NULL CHECK (tipo::text = ANY (ARRAY['INGRESO'::character varying, 'EGRESO'::character varying]::text[])),
  ingreso numeric NOT NULL DEFAULT 0.00,
  egreso numeric NOT NULL DEFAULT 0.00,
  saldo numeric NOT NULL,
  id_factura uuid,
  numero_comprobante character varying,
  id_responsable uuid NOT NULL,
  beneficiario character varying,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fondos_movimientos_pkey PRIMARY KEY (id),
  CONSTRAINT fondos_movimientos_id_fondo_fkey FOREIGN KEY (id_fondo) REFERENCES public.fondos_catalogo(id),
  CONSTRAINT fondos_movimientos_id_factura_fkey FOREIGN KEY (id_factura) REFERENCES public.facturas(id),
  CONSTRAINT fondos_movimientos_id_responsable_fkey FOREIGN KEY (id_responsable) REFERENCES public.usuarios(id)
);