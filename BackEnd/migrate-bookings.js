const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'data', 'bookings.json');
const bookings = JSON.parse(fs.readFileSync(file, 'utf8'));

for (const booking of bookings) {
  const seats = Array.isArray(booking.seats)
    ? booking.seats.map(String).filter(Boolean)
    : (booking.seat ? [String(booking.seat)] : []);

  booking.seats = seats;
  booking.seat = seats[0] || null;
  booking.passengerCount = Number.isInteger(booking.passengerCount)
    ? booking.passengerCount
    : Math.max(1, seats.length);
  booking.basePrice = Number.isFinite(Number(booking.basePrice))
    ? Number(booking.basePrice)
    : Number(booking.price) || 0;
  booking.travelDate = booking.travelDate || null;
  booking.status = booking.status || 'Confirmed';
  booking.schemaVersion = 2;
}

fs.writeFileSync(file, JSON.stringify(bookings, null, 2) + '\n');
console.log(`Migrated ${bookings.length} booking(s) to schema v2.`);
