import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import glob
import csv
import re
from bs4 import BeautifulSoup

class FlightScraperApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Flight Data Manager")
        self.root.geometry("1000x600")

        self.all_flights = [] # List of dicts
        self.fare_columns = [] # List of fare column names
        self.base_columns = ["Airline", "FlightNumber", "DepartureTime", "Origin", "ArrivalTime", "Destination", "Duration", "Stops"]
        
        # UI Layout
        self.create_widgets()

    def create_widgets(self):
        # Top Control Panel
        control_frame = ttk.Frame(self.root, padding=10)
        control_frame.pack(fill=tk.X, side=tk.TOP)

        ttk.Button(control_frame, text="1. Load & Scrape HTML", command=self.load_data).pack(side=tk.LEFT, padx=5)
        ttk.Button(control_frame, text="3. Save to CSV", command=self.save_data).pack(side=tk.RIGHT, padx=5)

        # Markup Control Frame
        markup_frame = ttk.LabelFrame(control_frame, text="2. Pricing & Markup", padding=10)
        markup_frame.pack(side=tk.LEFT, padx=20, fill=tk.X, expand=True)

        # Global Markup
        ttk.Label(markup_frame, text="Global Markup:").grid(row=0, column=0, padx=5, sticky="e")
        self.global_markup_var = tk.StringVar(value="0")
        ttk.Entry(markup_frame, textvariable=self.global_markup_var, width=10).grid(row=0, column=1, padx=5)
        ttk.Button(markup_frame, text="Apply to All", command=self.apply_global_markup).grid(row=0, column=2, padx=5)

        # Column Markup
        ttk.Label(markup_frame, text="Column Markup:").grid(row=0, column=3, padx=5, sticky="e")
        self.col_combo = ttk.Combobox(markup_frame, state="readonly", width=15)
        self.col_combo.grid(row=0, column=4, padx=5)
        self.col_markup_var = tk.StringVar(value="0")
        ttk.Entry(markup_frame, textvariable=self.col_markup_var, width=10).grid(row=0, column=5, padx=5)
        ttk.Button(markup_frame, text="Apply to Column", command=self.apply_col_markup).grid(row=0, column=6, padx=5)

        # Treeview (Table)
        self.tree_frame = ttk.Frame(self.root)
        self.tree_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        # Scrollbars
        self.tree_scroll_y = ttk.Scrollbar(self.tree_frame)
        self.tree_scroll_y.pack(side=tk.RIGHT, fill=tk.Y)
        self.tree_scroll_x = ttk.Scrollbar(self.tree_frame, orient=tk.HORIZONTAL)
        self.tree_scroll_x.pack(side=tk.BOTTOM, fill=tk.X)

        self.tree = ttk.Treeview(self.tree_frame, yscrollcommand=self.tree_scroll_y.set, xscrollcommand=self.tree_scroll_x.set)
        self.tree.pack(fill=tk.BOTH, expand=True)

        self.tree_scroll_y.config(command=self.tree.yview)
        self.tree_scroll_x.config(command=self.tree.xview)

    def load_data(self):
        input_pattern = "flight_page_*.html"
        html_files = glob.glob(input_pattern)
        
        if not html_files:
            messagebox.showerror("Error", "No 'flight_page_*.html' files found.")
            return

        self.all_flights = []
        unique_fares = set()

        # --- Parsing Logic (Same as before) ---
        for file_path in html_files:
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
                soup = BeautifulSoup(content, 'html.parser')
                results = soup.find_all("div", class_="flightresult_grid")

                for res in results:
                    flight = {}
                    # Basic Info
                    try:
                        flight_name_div = res.find("div", class_="flightname")
                        flight['Airline'] = flight_name_div.find("div", class_="fn_rht").find("h4").get_text(strip=True) if flight_name_div else "N/A"
                        
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
                        flight['FlightNumber'] = ", ".join(flight_nos)

                        dep_box = res.find("div", class_="fdepbx")
                        flight['DepartureTime'] = dep_box.find("tt").get_text(strip=True) if dep_box else "N/A"
                        flight['Origin'] = dep_box.find("span", id=lambda x: x and "OriginAirportCode" in x).get_text(strip=True) if dep_box else "N/A"

                        arr_box = res.find("div", class_="farrbx")
                        flight['ArrivalTime'] = arr_box.find("tt").get_text(strip=True) if arr_box else "N/A"
                        flight['Destination'] = arr_box.find("span", id=lambda x: x and "DestinationAirportCode" in x).get_text(strip=True) if arr_box else "N/A"

                        dur_box = res.find("div", class_="durationbx")
                        flight['Duration'] = dur_box.find("tt").get_text(strip=True) if dur_box else "N/A"
                        
                        stop_box = res.find("div", class_="stopbx")
                        flight['Stops'] = stop_box.find("span", class_="text-danger").get_text(strip=True) if stop_box else "0 Stop"
                    except Exception:
                        continue

                    # Dynamic Prices
                    price_blocks = res.find_all("div", class_="flpricebx")
                    for pb in price_blocks:
                        tag_div = pb.find("div", class_="fareClassTag")
                        fare_name = tag_div.find("span", class_="comtag").get_text(strip=True) if tag_div and tag_div.find("span", class_="comtag") else "Standard"
                        
                        unique_fares.add(fare_name)
                        
                        offer_price_tag = pb.find("tt", id=lambda x: x and x.startswith("OfferPrice_"))
                        if offer_price_tag:
                            clean_price = re.sub(r'[^\d.]', '', offer_price_tag.get_text(strip=True))
                            try:
                                val = float(clean_price)
                                flight[fare_name] = val if val > 0 else "" # Store as float for calc, or empty string
                            except:
                                flight[fare_name] = ""
                        else:
                             flight[fare_name] = ""
                    
                    self.all_flights.append(flight)

            except Exception as e:
                print(f"Error reading {file_path}: {e}")

        # --- Update Columns ---
        self.fare_columns = sorted(list(unique_fares))
        all_cols = self.base_columns + self.fare_columns
        
        self.tree["columns"] = all_cols
        self.tree["show"] = "headings"
        
        for col in all_cols:
            self.tree.heading(col, text=col)
            self.tree.column(col, width=100, minwidth=50)

        # Update combo box
        self.col_combo['values'] = self.fare_columns
        if self.fare_columns:
            self.col_combo.current(0)
            
        self.refresh_table()
        messagebox.showinfo("Loaded", f"Loaded {len(self.all_flights)} flights.")

    def refresh_table(self):
        # Clear existing
        for item in self.tree.get_children():
            self.tree.delete(item)
            
        # Insert Data
        for idx, flight in enumerate(self.all_flights):
            values = []
            for col in self.tree["columns"]:
                val = flight.get(col, "")
                if isinstance(val, float):
                    values.append(f"{val:.2f}")
                else:
                    values.append(val)
            self.tree.insert("", "end", values=values)

    def apply_global_markup(self):
        try:
            markup = float(self.global_markup_var.get())
        except ValueError:
            messagebox.showerror("Error", "Invalid markup value.")
            return

        cols_modified = 0
        for flight in self.all_flights:
            for fare_col in self.fare_columns:
                val = flight.get(fare_col)
                if isinstance(val, float): # Only update existing float values
                    flight[fare_col] = val + markup
                    cols_modified += 1
        
        self.refresh_table()
        messagebox.showinfo("Success", f"Applied markup to all valid prices.")

    def apply_col_markup(self):
        target_col = self.col_combo.get()
        if not target_col:
            messagebox.showerror("Error", "Select a column first.")
            return
            
        try:
            markup = float(self.col_markup_var.get())
        except ValueError:
            messagebox.showerror("Error", "Invalid markup value.")
            return

        count = 0
        for flight in self.all_flights:
            val = flight.get(target_col)
            if isinstance(val, float):
                flight[target_col] = val + markup
                count += 1
        
        self.refresh_table()
        messagebox.showinfo("Success", f"Updated {count} rows in column '{target_col}'.")

    def save_data(self):
        if not self.all_flights:
            messagebox.showwarning("Warning", "No data to save.")
            return

        filename = "flight_data_final.csv"
        
        # Prepare headers
        headers = self.tree["columns"]
        
        try:
            with open(filename, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=headers, restval='')
                writer.writeheader()
                for flight in self.all_flights:
                    # formatted rows
                    row = flight.copy()
                    # ensure floats are formatted nicely
                    for k, v in row.items():
                        if isinstance(v, float):
                            row[k] = f"{v:.2f}"
                    writer.writerow(row)
            
            messagebox.showinfo("Saved", f"Data saved to {filename}")
        except Exception as e:
            messagebox.showerror("Error", str(e))

if __name__ == "__main__":
    root = tk.Tk()
    app = FlightScraperApp(root)
    root.mainloop()
