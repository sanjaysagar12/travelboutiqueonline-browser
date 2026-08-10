// Isolated field mapping (parser layer): new flights-api JSON -> the
// extension's existing internal flight model (previously produced by an
// HTML DOM parser). dashboard.js already knows how to rename/consume this
// shape (FlightNumber, DepartureTime, Origin, ArrivalTime, Destination,
// Duration, Stops, plus one dynamic key per fare tier), so we keep it
// identical rather than inventing a new schema.

// "result" is an array of arrays (grouped itinerary options); flatten one
// level to get individual itineraries.
export function mapResultToFlights(result) {
  if (!Array.isArray(result)) return [];

  const itineraries = result.flat();
  const flights = [];

  for (const itinerary of itineraries) {
    const journeys = Array.isArray(itinerary.journey) ? itinerary.journey : [];
    if (journeys.length === 0) continue;

    const segments = journeys.flatMap(j => (Array.isArray(j.segments) ? j.segments : []));
    const firstJourney = journeys[0];
    const lastJourney = journeys[journeys.length - 1];

    const airlineNames = [...new Set(segments.map(s => s.airlineName).filter(Boolean))];
    const flightNumbers = segments
      .map(s => (s.airlineCode && s.flightNumber ? `${s.airlineCode}-${s.flightNumber}` : null))
      .filter(Boolean);

    // stopCount is per-journey-leg (connections within that leg); sum
    // across legs for a single combined "Stops" figure.
    const stopCount = journeys.reduce((sum, j) => sum + (Number(j.stopCount) || 0), 0);
    const stopsLabel = stopCount === 0 ? '0 Stop' : `${stopCount} Stop${stopCount > 1 ? 's' : ''}`;

    const durationLabel = journeys.map(j => j.duration).filter(Boolean).join(' + ');

    const base = {
      Airline: airlineNames.join(' / ') || 'N/A',
      FlightNumber: flightNumbers.length ? flightNumbers.join(', ') : 'N/A',
      DepartureTime: firstJourney.deptTime || 'N/A',
      Origin: firstJourney.origin || 'N/A',
      ArrivalTime: lastJourney.arrTime || 'N/A',
      Destination: lastJourney.destination || 'N/A',
      Duration: durationLabel || 'N/A',
      Stops: stopsLabel
    };

    let dedupeKey = null;
    const fareOptions = Array.isArray(itinerary.fareOptions) ? itinerary.fareOptions : [];

    for (const fareOption of fareOptions) {
      const fareName = (fareOption.fareClassification && fareOption.fareClassification.text) || 'Standard';
      const fares = fareOption.fares || {};
      const priceValue = fares.offer && fares.offer.value !== undefined
        ? fares.offer.value
        : (fares.publish && fares.publish.value !== undefined ? fares.publish.value : '');

      base[fareName] = priceValue;

      if (!dedupeKey && fareOption.resultIndex) {
        dedupeKey = fareOption.resultIndex;
      }
    }

    if (!dedupeKey) {
      dedupeKey = `${base.FlightNumber}|${base.DepartureTime}|${base.ArrivalTime}`;
    }

    // _id is only used for cross-page dedupe; it is stripped before the
    // flight is stored (dashboard.js only ever renders baseColumns +
    // discovered fare columns, so leaving it would just be dead weight).
    flights.push({ ...base, _id: dedupeKey });
  }

  return flights;
}

// Derives the route/date header shown on the dashboard directly from the
// API response, avoiding any dependency on the new site's DOM structure.
export function deriveFlightInfo(result) {
  if (!Array.isArray(result)) return null;

  for (const itinerary of result.flat()) {
    const journeys = Array.isArray(itinerary.journey) ? itinerary.journey : [];
    if (journeys.length === 0) continue;

    const first = journeys[0];
    const last = journeys[journeys.length - 1];
    const fromLabel = first.originCityName ? `${first.originCityName} (${first.origin})` : first.origin;
    const toLabel = last.destinationCityName ? `${last.destinationCityName} (${last.destination})` : last.destination;

    if (!fromLabel || !toLabel) continue;

    return {
      route: `${fromLabel} to ${toLabel}`,
      date: first.deptDate || ''
    };
  }

  return null;
}
