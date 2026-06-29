# Buenas prácticas para la redacción de prompts en sistemas de agentes IA

## Principio general

> **Un buen prompt debe ser claro, directo y fácil de ejecutar.**

No conviene escribir prompts largos, ambiguos o con contexto irrelevante. Cuanto más claro y estructurado esté, más consistente será la respuesta.

---

## 1. Priorizar claridad y concisión

El prompt debe indicar de forma directa:
- qué tiene que hacer el agente
- con qué información cuenta
- qué límites debe respetar
- qué salida se espera

## Recomendación
- usa frases simples
- evita ambigüedades
- evita instrucciones duplicadas o contradictorias
- no mezcles demasiados objetivos en un mismo prompt
- incluye solo el contexto que realmente sea útil

---

## 2. Redactar el prompt en inglés

En general, se recomienda redactar los prompts en **inglés**, especialmente en sistemas productivos.

## Motivos
- los modelos suelen estar mejor optimizados para inglés
- el comportamiento suele ser más consistente
- muchas instrucciones técnicas son más estándar en inglés
- normalmente consume menos tokens que el español para expresar lo mismo

## Buena práctica
- escribe las instrucciones del prompt en inglés
- indica explícitamente el idioma de salida si la respuesta final debe darse en español u otro idioma
- evita mezclar idiomas dentro del mismo prompt salvo que sea necesario

---

## 3. Estructurar siempre el prompt por secciones

Es mejor escribir el prompt en bloques claros que en un único párrafo.

## Estructura recomendada

```text
Role:
[Qué es o qué hace el agente]

Objective:
[Qué debe conseguir]

Context:
[Información relevante para la tarea]

Instructions:
- [Qué debe hacer]
- [Cómo debe hacerlo]
- [Criterios que debe seguir]

Constraints:
- [Qué no debe hacer]
- [Límites o reglas obligatorias]

Examples:
- Input: [...]
  Output: [...]
- Input: [...]
  Output: [...]

Output format:
[Idioma, estructura, longitud y formato esperado]
```

## Qué debe incluir cada sección

- **Role**: define la función del agente de forma concreta.
- **Objective**: indica el resultado que debe conseguir.
- **Context**: aporta solo la información necesaria para ejecutar bien la tarea.
- **Instructions**: recoge las reglas operativas y los criterios de ejecución.
- **Constraints**: marca límites claros, prohibiciones o condiciones obligatorias.
- **Examples**: conviene incluirlos siempre que sea posible para fijar comportamiento y formato esperado.
- **Output format**: especifica cómo debe responder, en qué idioma y con qué estructura.

Esta estructura hace el prompt más mantenible y reduce errores.

---

## 4. Usar texto plano por defecto

> **Texto plano suele ser la mejor opción para redactar prompts.**

Es simple, portable y suficiente en la mayoría de casos.

## Cuándo usar Markdown
Puede utilizarse si ayuda a:
- separar secciones
- mejorar la legibilidad
- ordenar listas o pasos

## Recomendación
- usa texto plano como base
- usa Markdown ligero solo cuando mejore la claridad
- evita formato excesivo si no aporta valor

---

## 5. Dar instrucciones concretas y operativas

Funcionan mejor las instrucciones específicas que las genéricas.

## Mejor
- “summarize in 5 bullet points”
- “return a JSON with fields X, Y and Z”
- “if a critical data point is missing, say so explicitly”

## Peor
- “do it well”
- “be smart”
- “answer as best as possible”

Cuanto más accionable sea la instrucción, mejor.

---

## 6. Separar reglas permanentes de instrucciones de tarea

No conviene mezclar en el mismo bloque:
- reglas estables del agente
- instrucciones específicas de una petición concreta

## Buena práctica
- define un prompt base con rol, políticas, tono y límites
- añade aparte el prompt de tarea con objetivo, contexto y salida esperada

Esto facilita el mantenimiento y la reutilización.

---

## 7. Evitar sobrecargar el prompt

Un prompt demasiado cargado empeora la claridad y hace más difícil seguir bien las prioridades.

## Señales de mal prompt
- reglas repetidas
- demasiadas excepciones
- objetivos mezclados
- contexto irrelevante
- instrucciones difíciles de priorizar

## Recomendaciones finales

- escribe prompts **claros, directos y breves**
- redacta las instrucciones en **inglés**
- estructura siempre el prompt por **secciones**
- incluye **ejemplos** cuando sea posible
- usa **texto plano por defecto**
- especifica de forma explícita el **formato de salida**
- separa las **reglas permanentes** de las **instrucciones de tarea**
- elimina cualquier contenido que no aporte valor real