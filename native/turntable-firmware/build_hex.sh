#!/bin/bash
# Builds StopMoTurntable.hex for an Arduino Uno (ATmega328P, 16 MHz) with avr-gcc and the Arduino AVR core.
# The app bundles the result and installs it over USB, so users never need the Arduino IDE.
set -euo pipefail
cd "$(dirname "$0")"
CORE=${ARDUINO_CORE:-/usr/share/arduino/hardware/arduino/avr}
OUT=build
rm -rf "$OUT" && mkdir -p "$OUT"
FLAGS="-mmcu=atmega328p -DF_CPU=16000000L -DARDUINO=10819 -DARDUINO_AVR_UNO -DARDUINO_ARCH_AVR -Os -ffunction-sections -fdata-sections -I$CORE/cores/arduino -I$CORE/variants/standard"
for f in "$CORE"/cores/arduino/*.c; do avr-gcc $FLAGS -c "$f" -o "$OUT/$(basename "$f").o"; done
for f in "$CORE"/cores/arduino/*.cpp; do avr-g++ $FLAGS -std=gnu++11 -fno-exceptions -fno-threadsafe-statics -c "$f" -o "$OUT/$(basename "$f").o"; done
avr-g++ $FLAGS -std=gnu++11 -fno-exceptions -fno-threadsafe-statics -x c++ -include Arduino.h -c StopMoTurntable/StopMoTurntable.ino -o "$OUT/sketch.o"
avr-gcc -mmcu=atmega328p -Os -Wl,--gc-sections -o "$OUT/StopMoTurntable.elf" "$OUT"/*.o -lm
avr-objcopy -O ihex -R .eeprom "$OUT/StopMoTurntable.elf" StopMoTurntable.hex
avr-size --mcu=atmega328p -C "$OUT/StopMoTurntable.elf" | grep -E "Program|Data"
rm -rf "$OUT"
