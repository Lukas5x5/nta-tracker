import * as L from 'leaflet'

declare module 'leaflet' {
  namespace imageOverlay {
    function rotated(
      imageUrl: string,
      topleft: L.LatLngExpression,
      topright: L.LatLngExpression,
      bottomleft: L.LatLngExpression,
      options?: L.ImageOverlayOptions
    ): L.ImageOverlay & {
      reposition(
        topleft: L.LatLngExpression,
        topright: L.LatLngExpression,
        bottomleft: L.LatLngExpression
      ): void
    }
  }
}

declare module 'leaflet-imageoverlay-rotated' {
  import * as L from 'leaflet'
  export = L
}
