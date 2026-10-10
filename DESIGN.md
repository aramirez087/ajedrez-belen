# Ajedrez Belén — primera versión

Editorial cálido y comunitario. El ancla es un render original de tablero y piezas Staunton de madera, junto a tipografía grande. La composición quiere invitar a las familias y a quienes empiezan. DFII: impacto 4, contexto 5, factibilidad 5, rendimiento 5, riesgo 4 = 15.

Marfil #f5f2e9; tinta #20231f; rojo #a32930; texto secundario #686b61; salvia #e6e9df. DM Sans variable, local, con peso medio para titulares y regular para lectura. Márgenes de 24–88 px. Una entrada de 700 ms y luego quietud; sin scroll controlado ni observadores. Preferencia de movimiento reducido respetada.

Solo hechos suministrados. No se publican edades, sede, horarios o WhatsApp hasta confirmarlos. La llamada principal llega al bloque de consultas; el borrador se puede copiar, pero no se envía. Al confirmar WhatsApp, cambiar `src/data/association.ts`.

La ilustración estática `chess-staunton-v2.webp` sustituye las piezas vectoriales rechazadas por el usuario. Fue generada con imagegen integrado y optimizada localmente. El original queda en `assets/originals/chess-staunton-v2.png`. Tiene transparencia real y no representa alumnos, sede ni un evento de la asociación.

`HeroBoard.astro` acepta una futura foto autorizada y su descripción. La imagen se revela a través de las casillas claras, con la misma entrada breve. Ese modo ya no incluye las piezas vectoriales rechazadas. El escudo, la ilustración y la foto se configuran en los datos. Mantener originales y crear derivados optimizados en `public/media`. La rama fotográfica se revisará con los píxeles reales antes de activarla.
