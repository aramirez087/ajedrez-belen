# Ajedrez Belén — composición estática

La dirección final conserva el caballo aprobado por el usuario y elimina la coreografía de scroll. El hero funciona como una portada editorial: “Un tablero.” a gran escala, caballo de madera como ancla asimétrica sobre una cuadrícula en perspectiva, “Un mundo por descubrir.” recorriendo la página y una franja inferior para explicación y WhatsApp. La cuadrícula es un recurso gráfico, no una posición de partida. No hay trazas de movimiento, entrada animada, tramo sticky, revelaciones forzadas ni código de scroll.

Marfil #f5f2e9, tinta #20231f, rojo #a32930, texto secundario #686b61 y salvia #e9ece3. Tipografía DM Sans variable local. Marco máximo de 1480 px; los márgenes exteriores crecen en pantallas grandes, en lugar de separar el texto y el caballo. Caballo de 350 px en escritorio, 335 px entre 900 y 1199 px y 270 px en móvil. Por debajo de 900 px el texto, explicación y CTA aparecen antes del caballo. El botón sigue visible en la primera pantalla móvil probada.

Las secciones conservan una composición editorial tranquila, niveles en filas, mensualidades alineadas y cierre “Tu próxima jugada empieza aquí.”. Solo se usan los hechos suministrados. No hay inscripción, cobro, historial inventado, testimonios o fotos de estudiantes generadas.

El render `knight-staunton-v4.webp` es el derivado optimizado del mismo caballo que aprobó el usuario. Original y prompt en `assets/originals/knight-staunton-v4.png` y `assets/GENERATION.md`. El escudo es provisional y reemplazable en datos.

`HeroBoard.astro` permite incorporar más adelante una fotografía autorizada a través de casillas claras. La rama permanece desactivada (`heroPhoto: null`); exige materializar y revisar los píxeles reales antes de activarse. No añade animación. No confundir un montaje por casillas con una foto actual de la asociación.

