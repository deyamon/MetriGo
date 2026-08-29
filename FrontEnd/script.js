document.addEventListener("DOMContentLoaded", function () {

    const fromInput = document.getElementById("from");
    const toInput = document.getElementById("to");
    const swapBtn = document.getElementById("swapBtn");

    swapBtn.addEventListener("click", () => {
    const temp = fromInput.value;
    fromInput.value = toInput.value;
    toInput.value = temp;
    });

    flatpickr("#datePicker", {
    minDate: "today",
    dateFormat: "d-m-Y",
    disableMobile: true,
    });

    // =============================
    // 1. INITIALIZE MAP
    // =============================
    var map = L.map('map', {
        zoomControl: true,
        minZoom: 10,
        maxZoom: 18
    }).setView([28.6139, 77.2090], 12);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
    }).addTo(map);

    var metroIcon = L.icon({
        iconUrl: "https://cdn-icons-png.flaticon.com/512/3448/3448339.png",
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32]
    });

    // =============================
    // 2. STATION COORDINATES
    // =============================
    var stationCoords = {
        "Samaypur Badli":           [28.7256, 77.1469],
        "Rohini Sector 18-19":      [28.7178, 77.1386],
        "Haiderpur Badli Mor":      [28.7107, 77.1507],
        "Jahangirpuri":             [28.7277, 77.1641],
        "Adarsh Nagar":             [28.7148, 77.1763],
        "Azadpur":                  [28.7032, 77.1762],
        "Model Town":               [28.6986, 77.1924],
        "GTB Nagar":                [28.6920, 77.2069],
        "Vishwavidyalaya":          [28.6890, 77.2147],
        "Vidhan Sabha":             [28.6799, 77.2231],
        "Civil Lines":              [28.6737, 77.2256],
        "Kashmere Gate":            [28.6675, 77.2281],
        "Chandni Chowk":            [28.6561, 77.2303],
        "Chawri Bazar":             [28.6493, 77.2272],
        "New Delhi":                [28.6431, 77.2197],
        "Rajiv Chowk":              [28.6330, 77.2194],
        "Patel Chowk":              [28.6254, 77.2166],
        "Central Secretariat":      [28.6157, 77.2136],
        "Udyog Bhawan":             [28.6107, 77.2114],
        "Lok Kalyan Marg":          [28.6006, 77.2088],
        "Jor Bagh":                 [28.5913, 77.2107],
        "INA":                      [28.5742, 77.2090],
        "AIIMS":                    [28.5672, 77.2100],
        "Green Park":               [28.5578, 77.2066],
        "Hauz Khas":                [28.5494, 77.2066],
        "Malviya Nagar":            [28.5340, 77.2066],
        "Saket":                    [28.5224, 77.2066],
        "Qutab Minar":              [28.5052, 77.1855],
        "Chhatarpur":               [28.4974, 77.1670],
        "Sultanpur":                [28.4889, 77.1547],
        "Ghitorni":                 [28.4782, 77.1426],
        "Arjan Garh":               [28.4682, 77.1236],
        "Guru Dronacharya":         [28.4636, 77.1050],
        "Sikanderpur":              [28.4728, 77.0942],
        "MG Road":                  [28.4796, 77.0893],
        "IFFCO Chowk":              [28.4728, 77.0763],
        "HUDA City Centre":         [28.4595, 77.0266],
        "Dwarka Sec 21":            [28.5921, 77.0460],
        "Dwarka Sec 18-19":         [28.5934, 77.0552],
        "Dwarka Sec 10":            [28.5948, 77.0640],
        "Dwarka Sec 11-12":         [28.5929, 77.0714],
        "Dwarka":                   [28.5916, 77.0731],
        "Dwarka Mor":               [28.6100, 77.0590],
        "Nawada":                   [28.6216, 77.0682],
        "Uttam Nagar West":         [28.6216, 77.0785],
        "Uttam Nagar East":         [28.6216, 77.0870],
        "Janakpuri West":           [28.6216, 77.0980],
        "Janakpuri East":           [28.6270, 77.1113],
        "Tilak Nagar":              [28.6378, 77.1021],
        "Subhash Nagar":            [28.6378, 77.1113],
        "Tagore Garden":            [28.6378, 77.1205],
        "Rajouri Garden":           [28.6378, 77.1297],
        "Ramesh Nagar":             [28.6378, 77.1389],
        "Moti Nagar":               [28.6378, 77.1481],
        "Kirti Nagar":              [28.6378, 77.1573],
        "Shadipur":                 [28.6378, 77.1665],
        "Patel Nagar":              [28.6378, 77.1757],
        "Rajendra Place":           [28.6378, 77.1849],
        "Karol Bagh":               [28.6452, 77.1902],
        "Jhandewalan":              [28.6452, 77.1994],
        "Ramakrishna Ashram Marg":  [28.6378, 77.2086],
        "Barakhamba Road":          [28.6330, 77.2286],
        "Mandi House":              [28.6266, 77.2378],
        "Pragati Maidan":           [28.6266, 77.2470],
        "Indraprastha":             [28.6266, 77.2562],
        "Yamuna Bank":              [28.6224, 77.2878],
        "Laxmi Nagar":              [28.6308, 77.2770],
        "Nirman Vihar":             [28.6378, 77.2962],
        "Preet Vihar":              [28.6378, 77.3054],
        "Karkarduma":               [28.6378, 77.3146],
        "Anand Vihar":              [28.6452, 77.3238],
        "Kaushambi":                [28.6452, 77.3330],
        "Vaishali":                 [28.6454, 77.3479]
    };

    // =============================
    // 3. PLOT ALL STATIONS ON MAP
    // =============================
    Object.keys(stationCoords).forEach(function(name) {
        var coords = stationCoords[name];
        var marker = L.marker(coords, { icon: metroIcon }).addTo(map);
        marker.bindPopup("<b>" + name + "</b>");
        marker.on('mouseover', function(){ this.openPopup(); });
    });

    // =============================
    // 4. LOAD STATIONS INTO DROPDOWN
    // =============================
    fetch('http://localhost:8080/stations')
        .then(res => res.json())
        .then(stations => {
            const fromList = document.getElementById('fromInput');
            const toList   = document.getElementById('toInput');
            stations.forEach(s => {
                fromList.innerHTML += `<option value="${s.name}">`;
                toList.innerHTML   += `<option value="${s.name}">`;
            });
        })
        .catch(err => console.log('Could not load stations:', err));

    // =============================
    // 5. SEARCH BUTTON
    // =============================
    var currentRouteLine = null;

    document.getElementById('searchBtn').addEventListener('click', function () {

        const from = document.getElementById('from').value.trim();
        const to   = document.getElementById('to').value.trim();

        if (!from || !to) {
            alert('Please enter both From and To stations!');
            return;
        }

        if (from.toLowerCase() === to.toLowerCase()) {
            alert('Source and destination cannot be the same!');
            return;
        }

        // Show loading message
        const resultBox = document.getElementById('resultBox');
        resultBox.style.display = 'block';
        resultBox.innerHTML = '⏳ Finding shortest path using Dijkstra...';

        // Call C backend via Node.js
        fetch('http://localhost:8080/shortest-path', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to })
        })
        .then(res => res.json())
        .then(data => {
            if (!data.success) {
                resultBox.innerHTML = '❌ Station not found. Check spelling and try again.';
                return;
            }
            drawRoute(data.path);
            showResult(data);
        })
        .catch(err => {
            resultBox.innerHTML = '❌ Cannot connect to server. Make sure node server.js is running.';
        });
    });

    // =============================
    // 6. DRAW ROUTE ON MAP
    // =============================
    function drawRoute(path) {
        if (currentRouteLine) {
            map.removeLayer(currentRouteLine);
        }

        var coords = path
            .filter(name => stationCoords[name])
            .map(name => stationCoords[name]);

        if (coords.length < 2) return;

        // Glow effect
        L.polyline(coords, {
            color: "#66b3ff",
            weight: 12,
            opacity: 0.3
        }).addTo(map);

        // Main route line
        currentRouteLine = L.polyline(coords, {
            color: "#0071e3",
            weight: 5,
            opacity: 0.9
        }).addTo(map);

        map.fitBounds(currentRouteLine.getBounds(), { padding: [60, 60] });
    }

    // =============================
    // 7. SHOW RESULT BOX
    // =============================
    function showResult(data) {
        const resultBox = document.getElementById('resultBox');
        resultBox.style.display = 'block';
        resultBox.innerHTML = `
            <h3 style="color:#FFFFFF; margin-bottom:8px">🚇 Route Found!</h3>
            <p><b>From:</b> ${data.from}</p>
            <p><b>To:</b> ${data.to}</p>
            <hr style="margin:8px 0">
            <p>📍 <b>Stops:</b> ${data.stops}</p>
            <p>📏 <b>Distance:</b> ${data.distance} km</p>
            <p>💰 <b>Fare:</b> ₹${data.fare}</p>
            <hr style="margin:8px 0">
            <p><b>Path:</b></p>
            <p style="font-size:12px; color:#FFFFFF; line-height:1.6">
                ${data.path.join(' → ')}
            </p>
        `;
    }

});