# 1. PROBLEMA

Actualmente, el sistema maneja diferentes conceptos que pueden formar parte de la deuda de un medidor:

* Deuda de alcantarillado.
* Deuda de periodos anteriores.
* Multas o rubros adicionales.
* Valor del periodo actual.
* Excedentes de consumo de agua.

El problema se presenta cuando un usuario **no paga el periodo actual** y llega el siguiente periodo.

Por ejemplo, durante julio una factura puede estar compuesta por:

| Concepto       |      Valor |
| -------------- | ---------: |
| Agua base      |      $7.00 |
| Excedentes     |      $3.00 |
| Alcantarillado |      $1.00 |
| Multa          |      $5.00 |
| **Total**      | **$16.00** |

El valor del agua del periodo actual tiene una distribución específica entre los diferentes fondos:

* $4.00 → Operación y Mantenimiento.
* $2.00 → Entrega al Padre.
* $0.50 → Fondo Mortuorio.
* $0.50 → Pago al Lector.
* Excedentes → Fondo Pro-mejoras e Infraestructura.
* $1.00 → Fondo de Alcantarillado cuando corresponda.
* Las multas deben distribuirse según las reglas establecidas para cada fondo.

El inconveniente aparece cuando la persona no paga los $16.00 de julio.

Si al generar agosto simplemente se toma ese valor y se convierte en:

```text
deuda_pasada = $16.00
```

se pierde el desglose original del periodo de julio.

El sistema ya no podría determinar correctamente:

```text
De los $16.00 pendientes:

$4.00  corresponden a Operación y Mantenimiento
$2.00  corresponden a Entrega al Padre
$0.50  corresponden al Fondo Mortuorio
$0.50  corresponden al Lector
$3.00  corresponden a Pro-mejoras
$1.00  corresponde a Alcantarillado
$5.00  corresponden a la multa
```

Además, existe una situación especial con las deudas anteriores al corte contable realizado en julio.

Antes del corte no se disponía del detalle necesario para determinar los excedentes ni la distribución histórica de cada deuda. Por esta razón, se estableció que las deudas anteriores al corte sean asignadas al Fondo de Operación y Mantenimiento.

Por lo tanto, existen dos tipos de información que deben conservarse:

1. **Deudas históricas anteriores al corte**, cuyo desglose no se conoce y que deben ser asignadas según la regla del corte contable.
2. **Deudas generadas desde el corte en adelante**, cuyo desglose sí debe conservarse porque el sistema conoce cómo se distribuye cada periodo.

El problema principal es que tratar `deuda_pasada` como un único monto provoca que se pierda el origen y la distribución de la deuda.

---
