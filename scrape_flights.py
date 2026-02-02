import os
import csv
import glob
from bs4 import BeautifulSoup
import re

def parse_html_files(input_pattern="flight_page_*.html", output_csv="flight_data.csv"):
    html_files = glob.glob(input_pattern)
    print(f"Found {len(html_files)} files to process.")

    all_flights = []
    all_fare_types = set()

    for file_path in html_files:
        print(f"Processing {file_path}...")
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
            
            soup = BeautifulSoup(content, 'html.parser')
            
            # Each flight result row
            results = soup.find_all("div", class_="flightresult_grid")

            for res in results:
                try:
                    # Flight Details Container
                    flight_name_div = res.find("div", class_="flightname")
                    airline = flight_name_div.find("div", class_="fn_rht").find("h4").get_text(strip=True) if flight_name_div else "N/A"
                    
                    # Flight Number
                    codes = res.select(".airlinecode kbd code[id='']")
                    flight_nos = [c.get_text(strip=True) + "-" + c.find_next("small").get_text(strip=True).replace("-", "").strip() for c in codes if c.find_next("small")]
                    if not flight_nos:
                         flight_nos_raw = res.select(".airlinecode kbd")
                         flight_nos = []
                         for k in flight_nos_raw:
                             c = k.find("code")
                             s = k.find("small")
                             if c and s:
                                 flight_nos.append(f"{c.get_text(strip=True)}-{s.get_text(strip=True).replace('-','').strip()}")

                    flight_number = ", ".join(flight_nos)

                    # Departure
                    dep_box = res.find("div", class_="fdepbx")
                    dep_time = dep_box.find("tt").get_text(strip=True) if dep_box else "N/A"
                    dep_airport = dep_box.find("span", id=lambda x: x and "OriginAirportCode" in x).get_text(strip=True) if dep_box else "N/A"

                    # Arrival
                    arr_box = res.find("div", class_="farrbx")
                    arr_time = arr_box.find("tt").get_text(strip=True) if arr_box else "N/A"
                    arr_airport = arr_box.find("span", id=lambda x: x and "DestinationAirportCode" in x).get_text(strip=True) if arr_box else "N/A"

                    # Duration & Stops
                    dur_box = res.find("div", class_="durationbx")
                    duration = dur_box.find("tt").get_text(strip=True) if dur_box else "N/A"
                    
                    stop_box = res.find("div", class_="stopbx")
                    stops = stop_box.find("span", class_="text-danger").get_text(strip=True) if stop_box else "0 Stop"

                    flight_base = {
                        "Airline": airline,
                        "FlightNumber": flight_number,
                        "DepartureTime": dep_time,
                        "Origin": dep_airport,
                        "ArrivalTime": arr_time,
                        "Destination": arr_airport,
                        "Duration": duration,
                        "Stops": stops
                    }

                    # --- Extract Multiple Prices ---
                    # Find the container for prices (usually .puboffer_pricebx or just search for .flpricebx inside the result row)
                    price_blocks = res.find_all("div", class_="flpricebx")
                    
                    for pb in price_blocks:
                        # Extract Fare Type Name
                        tag_div = pb.find("div", class_="fareClassTag")
                        if tag_div:
                            tag_span = tag_div.find("span", class_="comtag")
                            fare_name = tag_span.get_text(strip=True) if tag_span else "Standard"
                        else:
                            fare_name = "Standard"
                        
                        # Clean special characters for CSV header consistency
                        # e.g. "Saver (Regular)" -> "Saver (Regular)"
                        # Remove potentially problematic chars if needed, but keeping as is is usually fine for CSV
                        
                        # Extract Price
                        offer_price_tag = pb.find("tt", id=lambda x: x and x.startswith("OfferPrice_"))
                        if offer_price_tag:
                            price_str = offer_price_tag.get_text(strip=True).replace(",", "")
                            # Try clear currency symbol if stuck
                            price_str = re.sub(r'[^\d.]', '', price_str)
                        else:
                            price_str = "0"

                        flight_base[fare_name] = price_str
                        all_fare_types.add(fare_name)

                    all_flights.append(flight_base)

                except Exception as e:
                    print(f"Error parsing row: {e}")
                    continue

        except Exception as file_err:
            print(f"Error reading file {file_path}: {file_err}")

    # Prepare complete field names
    base_headers = ["Airline", "FlightNumber", "DepartureTime", "Origin", "ArrivalTime", "Destination", "Duration", "Stops"]
    # Sort fare types for consistent column order
    dynamic_headers = sorted(list(all_fare_types))
    fieldnames = base_headers + dynamic_headers

    # Write to CSV
    if all_flights:
        with open(output_csv, 'w', newline='', encoding='utf-8') as output_file:
            # restval='0' ensures missing prices for a specific column get '0'
            dict_writer = csv.DictWriter(output_file, fieldnames=fieldnames, restval='0')
            dict_writer.writeheader()
            dict_writer.writerows(all_flights)
        print(f"Successfully saved {len(all_flights)} flights to {output_csv}")
        print(f"Fare columns found: {dynamic_headers}")
    else:
        print("No flight data found.")

if __name__ == "__main__":
    parse_html_files()
