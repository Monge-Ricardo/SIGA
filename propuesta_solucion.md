Claro. Te dejo la solución completa en Markdown, lista para copiarla a tu documentación del proyecto.

````markdown
# Propuesta de manejo de deudas, periodos y distribución de fondos

## 1. Problema actual

El sistema maneja actualmente varios conceptos de deuda:

- `deuda_alcantarillado`
- `deuda_pasada`
- multas
- periodo activo actual
- excedentes de consumo

El problema aparece cuando una persona no paga el periodo actual.

Por ejemplo, una factura de julio puede tener:

| Concepto | Valor |
|---|---:|
| Agua base | $7.00 |
| Excedentes | $3.00 |
| Alcantarillado | $1.00 |
| Multa | $5.00 |
| **Total** | **$16.00** |

La distribución de esos $16 puede ser:

| Fondo | Valor |
|---|---:|
| Operación y Mantenimiento | $4.00 |
| Entrega al Padre | $2.00 |
| Fondo Mortuorio | $0.50 |
| Pago al Lector | $0.50 |
| Fondo Pro-mejoras e Infraestructura | $3.00 |
| Alcantarillado | $1.00 |
| Multas | $5.00 |
| **Total** | **$16.00** |

Si la persona no paga julio, **no se debe convertir simplemente esos $16 en `deuda_pasada`**, porque se perdería el desglose de a qué fondos pertenece cada parte.

---

# 2. Principio principal de la solución

## No mover ni eliminar la deuda de su periodo original

Una factura de julio debe seguir siendo una factura de julio aunque se pague en agosto, septiembre o años después.

Por ejemplo:

```text
Factura JULIO
Total: $16.00
Pagado: $0.00
Saldo: $16.00
````

Cuando llega agosto, la deuda de julio continúa existiendo:

```text
JULIO
    Total: $16.00
    Pagado: $0.00
    Saldo: $16.00

AGOSTO
    Nueva factura
```

La aplicación puede mostrar los $16 de julio como:

```text
DEUDA ANTERIOR
```

pero **solamente como una vista o agrupación**, no como una nueva deuda que reemplace a julio.

---

# 3. La deuda pasada debe ser una consulta, no una deuda independiente

Actualmente puede existir la idea de:

```text
deuda_pasada = $16
```

La propuesta es que `deuda_pasada` no sea la fuente principal de información.

En su lugar:

```text
DEUDA PASADA
=
SUMA DE SALDOS PENDIENTES
DE FACTURAS DE PERIODOS ANTERIORES
```

Conceptualmente:

```sql
SELECT SUM(saldo_pendiente)
FROM facturas
WHERE id_medidor = :id_medidor
  AND id_periodo <> :periodo_actual
  AND estado_pago <> 'PAGADO';
```

De esta manera:

```text
Julio      $16
Junio       $8
Mayo       $12
----------------
Deuda pasada = $36
```

Pero las tres facturas siguen existiendo individualmente.

---

# 4. Mantener el desglose de cada factura

Cada factura debe conservar sus componentes.

La tabla `facturas` actualmente ya contiene:

* `valor_base`
* `consumo_m3`
* `excedente_m3`
* `valor_excedente`
* `valor_alcantarillado`
* `valor_multas`
* `valor_deuda_anterior`
* `total_mes`
* `total_pagar`

Por lo tanto, la factura puede representar correctamente el periodo al que pertenece.

Sin embargo, hace falta una estructura adicional para representar la distribución hacia los fondos.

---

# 5. Nueva tabla: `factura_distribucion`

Se propone agregar:

```sql
CREATE TABLE factura_distribucion (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

    id_factura uuid NOT NULL,
    id_fondo uuid NOT NULL,

    monto numeric NOT NULL CHECK (monto > 0),

    monto_pagado numeric NOT NULL DEFAULT 0,
    saldo_pendiente numeric NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (id_factura)
        REFERENCES facturas(id),

    FOREIGN KEY (id_fondo)
        REFERENCES fondos_catalogo(id)
);
```

Esta tabla indica cuánto de una factura corresponde a cada fondo.

---

# 6. Ejemplo de distribución

Supongamos:

```text
Factura JULIO #001

Agua base          $7.00
Excedentes         $3.00
Alcantarillado     $1.00
Multa              $5.00
-------------------------
TOTAL             $16.00
```

La tabla `factura_distribucion` tendría:

| Factura   | Fondo                     |      Monto |    Pagado |      Saldo |
| --------- | ------------------------- | ---------: | --------: | ---------: |
| Julio     | Operación y Mantenimiento |      $4.00 |     $0.00 |      $4.00 |
| Julio     | Entrega al Padre          |      $2.00 |     $0.00 |      $2.00 |
| Julio     | Fondo Mortuorio           |      $0.50 |     $0.00 |      $0.50 |
| Julio     | Pago al Lector            |      $0.50 |     $0.00 |      $0.50 |
| Julio     | Pro-mejoras               |      $3.00 |     $0.00 |      $3.00 |
| Julio     | Alcantarillado            |      $1.00 |     $0.00 |      $1.00 |
| Julio     | Multa                     |      $5.00 |     $0.00 |      $5.00 |
| **TOTAL** |                           | **$16.00** | **$0.00** | **$16.00** |

Así se conserva el origen del dinero.

---

# 7. ¿Qué sucede si la persona paga parcialmente?

Supongamos que debe:

```text
Total: $16
```

pero solamente paga:

```text
$10
```

El sistema debe registrar cuánto se aplicó a cada distribución.

Por eso se recomienda una tabla de abonos general:

```sql
CREATE TABLE factura_abonos (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

    id_factura uuid NOT NULL,
    id_distribucion uuid NOT NULL,

    monto numeric NOT NULL CHECK (monto > 0),

    fecha timestamptz NOT NULL DEFAULT now(),

    id_cajero uuid,

    FOREIGN KEY (id_factura)
        REFERENCES facturas(id),

    FOREIGN KEY (id_distribucion)
        REFERENCES factura_distribucion(id),

    FOREIGN KEY (id_cajero)
        REFERENCES usuarios(id)
);
```

---

# 8. Ejemplo de pago parcial

Factura:

```text
$16.00
```

Pago:

```text
$10.00
```

El sistema puede aplicar el pago según la regla de prioridad definida por la organización.

Por ejemplo:

```text
Operación              $4.00
Padre                  $2.00
Mortuorio              $0.50
Lector                 $0.50
Pro-mejoras             $3.00
------------------------------
Pagado                 $10.00
```

Entonces queda:

```text
Operación              $0.00
Padre                  $0.00
Mortuorio              $0.00
Lector                 $0.00
Pro-mejoras             $0.00
Alcantarillado         $1.00
Multa                  $5.00
------------------------------
Saldo                   $6.00
```

La factura de julio continúa existiendo:

```text
Factura JULIO
Total:     $16.00
Pagado:    $10.00
Pendiente:  $6.00
```

---

# 9. Llegada del siguiente periodo

Cuando llega agosto, NO se debe hacer:

```text
Julio $16
    ↓
deuda_pasada $16
    ↓
eliminar desglose de julio
```

En cambio:

```text
                    MEDIDOR
                       │
            ┌──────────┴──────────┐
            │                     │
      DEUDA ANTERIOR         PERIODO ACTUAL
            │                     │
         JULIO                 AGOSTO
          $16                    $11
```

La interfaz puede mostrar:

```text
PERIODO ACTUAL

Agua                         $10.00
Alcantarillado                $1.00
-----------------------------------
Subtotal                     $11.00


DEUDAS ANTERIORES

Julio                         $16.00
Junio                          $8.00
-----------------------------------
Deuda anterior               $24.00


TOTAL A PAGAR                $35.00
```

Pero internamente:

```text
Factura Julio  → sigue siendo Julio
Factura Junio  → sigue siendo Junio
Factura Agosto → sigue siendo Agosto
```

---

# 10. Tratamiento del corte contable de julio

Existe una situación especial:

Antes de julio no existía información suficiente para conocer:

* excedentes históricos
* distribución histórica
* detalle de cada periodo
* distribución exacta hacia los fondos

Por lo tanto, debe realizarse un:

## Saldo inicial / corte contable

Por ejemplo:

```text
CORTE CONTABLE AL 31/07/2026

Medidor: 001
Saldo histórico: $35.00
```

Como no existe información histórica suficiente, se puede establecer:

```text
Fondo Operación y Mantenimiento
$35.00
```

Pero esto debe quedar registrado explícitamente como:

```text
ORIGEN = SALDO_INICIAL
PERIODO = CORTE_JULIO_2026
```

No debe confundirse con una factura normal de consumo.

---

# 11. El saldo inicial también debe conservar distribución

Por ejemplo:

| Origen        | Fondo                     |  Monto |
| ------------- | ------------------------- | -----: |
| Saldo inicial | Operación y Mantenimiento | $35.00 |

De esta manera, en el futuro se puede saber por qué esos $35 fueron asignados a ese fondo.

---

# 12. Tratamiento del agua del periodo actual

Para un usuario normal:

```text
Cargo fijo = $7.00
```

La distribución es:

```text
$4.00 → Operación y Mantenimiento
$2.00 → Entrega al Padre
$0.50 → Fondo Mortuorio
$0.50 → Pago al Lector
```

Total:

```text
$7.00
```

Si existen excedentes:

```text
Excedentes → Fondo Pro-mejoras e Infraestructura
```

Por ejemplo:

```text
Cargo fijo:       $7.00
Excedentes:       $3.00
Alcantarillado:   $1.00
------------------------
Total:           $11.00
```

Distribución:

```text
Operación                  $4.00
Padre                      $2.00
Mortuorio                  $0.50
Lector                     $0.50
Pro-mejoras                $3.00
Alcantarillado             $1.00
--------------------------------
TOTAL                     $11.00
```

---

# 13. Alcantarillado

Si el medidor tiene alcantarillado:

```text
$1.00 → Fondo de Alcantarillado
```

Si no tiene alcantarillado:

```text
$0.00
```

Por lo tanto, esta distribución debe generarse al momento de crear la factura.

---

# 14. Multas

Las multas actualmente tienen su propia tabla:

```text
multas_rubros
```

y contienen información como:

```text
tipo_rubro
monto
pagado
monto_pagado
saldo_pendiente
estado
```

La multa debe conservarse como obligación independiente.

Por ejemplo:

```text
Multa MINGA
Monto: $5
Pagado: $0
Saldo: $5
```

Si la multa debe distribuirse entre fondos:

```text
MULTA $5
   │
   ├── Fondo A $2
   ├── Fondo B $1
   └── Fondo C $2
```

No se debe convertir la multa directamente en `deuda_pasada`.

---

# 15. `fondos_movimientos`

La tabla:

```text
fondos_movimientos
```

debe representar los movimientos reales de dinero de los fondos.

Es decir:

```text
FACTURA
   ↓
DISTRIBUCIÓN
   ↓
PAGO
   ↓
MOVIMIENTO DEL FONDO
```

No debería generarse un ingreso en el fondo simplemente porque se creó una factura.

Una factura pendiente representa:

```text
DINERO POR COBRAR
```

No:

```text
DINERO YA RECIBIDO
```

El movimiento financiero del fondo debería generarse cuando efectivamente se realiza el pago.

---

# 16. Separar "deuda" de "dinero cobrado"

Este punto es fundamental.

### Factura

Representa:

```text
¿Cuánto debe la persona?
```

### Distribución

Representa:

```text
¿A qué fondo corresponde ese dinero?
```

### Abono

Representa:

```text
¿Cuánto de la deuda fue pagado?
```

### Movimiento del fondo

Representa:

```text
¿Cuánto dinero realmente ingresó al fondo?
```

---

# 17. Modelo conceptual final

```text
                         MEDIDOR
                            │
                            │
                       ┌────┴────┐
                       │         │
                   PERIODOS    SOCIO
                       │
                       │
                    FACTURAS
                       │
          ┌────────────┼────────────┐
          │            │            │
       LECTURA       MULTAS      DEUDA ANTERIOR
          │            │
          │            │
          └───────┬────┘
                  │
            DISTRIBUCIÓN
                  │
        ┌─────────┼─────────┐
        │         │         │
      FONDO A   FONDO B   FONDO C
        │         │         │
        └─────────┼─────────┘
                  │
                ABONOS
                  │
                  ↓
          MOVIMIENTOS FONDOS
```

---

# 18. Regla principal para el sistema

La regla debería ser:

> **Nunca destruir ni sobrescribir el origen de una deuda solamente porque cambió de periodo.**

Una deuda mantiene:

```text
Periodo en el que nació
Factura original
Concepto
Monto original
Distribución
Pagos realizados
Saldo pendiente
```

Cuando cambia el periodo:

```text
NO SE MUEVE
NO SE COPIA
NO SE SOBRESCRIBE
NO SE REEMPLAZA
```

Simplemente pasa a aparecer en:

```text
DEUDA ANTERIOR
```

mediante una consulta.

---

# 19. Resultado final

La estructura lógica sería:

```text
PERIODO
   │
   └── FACTURA
          │
          ├── Agua base
          ├── Excedentes
          ├── Alcantarillado
          ├── Multas
          │
          └── FACTURA_DISTRIBUCION
                  │
                  ├── Operación
                  ├── Padre
                  ├── Mortuorio
                  ├── Lector
                  ├── Pro-mejoras
                  └── Alcantarillado
                          │
                          ↓
                       ABONOS
                          │
                          ↓
                  MOVIMIENTOS DE FONDOS
```

Y:

```text
DEUDA PASADA
```

sería únicamente:

```text
SUMA DE SALDOS PENDIENTES
DE FACTURAS DE PERIODOS ANTERIORES
```

```
```
