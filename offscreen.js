chrome.runtime.onMessage.addListener(handleMessage);

function handleMessage(request, sender, sendResponse) {
    if (request.action === 'PARSE_HTML') {
        const data = parseHtml(request.htmlChunk);
        sendResponse(data);
    }
}

function parseHtml(htmlContent) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    // Adapted from Python script logic
    const results = doc.querySelectorAll("div.flightresult_grid");
    const extractedFlights = [];

    results.forEach(res => {
        try {
            // Airline
            let airline = "N/A";
            const fnDiv = res.querySelector("div.flightname div.fn_rht h4");
            if (fnDiv) airline = fnDiv.textContent.trim();

            // Flight Number
            const codeTags = res.querySelectorAll(".airlinecode kbd");
            let flightNos = [];
            codeTags.forEach(k => {
                const c = k.querySelector("code");
                const s = k.querySelector("small");
                if (c && s) {
                    flightNos.push(`${c.textContent.trim()}-${s.textContent.trim().replace('-', '').trim()}`);
                }
            });
            const flightNumber = flightNos.length ? flightNos.join(", ") : "N/A";

            // Dep
            const depBox = res.querySelector("div.fdepbx");
            const depTime = depBox ? depBox.querySelector("tt")?.textContent.trim() : "N/A";
            const depOrigin = depBox ? depBox.querySelector("span[id*='OriginAirportCode']")?.textContent.trim() : "N/A";

            // Arr
            const arrBox = res.querySelector("div.farrbx");
            const arrTime = arrBox ? arrBox.querySelector("tt")?.textContent.trim() : "N/A";
            const arrDest = arrBox ? arrBox.querySelector("span[id*='DestinationAirportCode']")?.textContent.trim() : "N/A";

            // Duration & Stops
            const durBox = res.querySelector("div.durationbx");
            const duration = durBox ? durBox.querySelector("tt")?.textContent.trim() : "N/A";

            const stopBox = res.querySelector("div.stopbx");
            const stops = stopBox ? stopBox.querySelector("span.text-danger")?.textContent.trim() : "0 Stop";

            const flightData = {
                Airline: airline,
                FlightNumber: flightNumber,
                DepartureTime: depTime || "N/A",
                Origin: depOrigin || "N/A",
                ArrivalTime: arrTime || "N/A",
                Destination: arrDest || "N/A",
                Duration: duration || "N/A",
                Stops: stops || "0 Stop"
            };

            // Dynamic Prices
            const priceBlocks = res.querySelectorAll("div.flpricebx");
            priceBlocks.forEach(pb => {
                const tagDiv = pb.querySelector("div.fareClassTag span.comtag");
                const fareName = tagDiv ? tagDiv.textContent.trim() : "Standard";

                const offerPriceTag = pb.querySelector("tt[id^='OfferPrice_']");
                let priceStr = "";

                if (offerPriceTag) {
                    // Clean price: remove non-numeric chars except dot
                    const raw = offerPriceTag.textContent.trim();
                    priceStr = raw.replace(/[^\d.]/g, '');
                }

                flightData[fareName] = priceStr;
            });

            extractedFlights.push(flightData);

        } catch (e) {
            console.error("Error parsing row in offscreen:", e);
        }
    });

    return extractedFlights;
}
