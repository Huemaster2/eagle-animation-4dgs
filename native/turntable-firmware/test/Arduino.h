#pragma once
#include <string>
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <deque>
typedef uint8_t byte;
#define HIGH 1
#define LOW 0
#define OUTPUT 1
#define F(x) x
extern unsigned long simMicros;
inline unsigned long micros() { return simMicros; }
inline unsigned long millis() { return simMicros / 1000; }
inline void delayMicroseconds(unsigned int us) { simMicros += us; }
inline void delay(unsigned long ms) { simMicros += ms * 1000; }
void pinMode(int, int);
void digitalWrite(int pin, int v);
template<class T> T max(T a, T b) { return a > b ? a : b; }
class String {
public:
  std::string s;
  String() {}
  String(const char* c) : s(c) {}
  String(const std::string& x) : s(x) {}
  void reserve(int) {}
  unsigned int length() const { return s.size(); }
  void trim() { size_t a = s.find_first_not_of(" \t\r\n"); size_t b = s.find_last_not_of(" \t\r\n"); s = a == std::string::npos ? "" : s.substr(a, b - a + 1); }
  void toUpperCase() { for (auto& c : s) c = toupper(c); }
  int indexOf(char c, unsigned int from = 0) const { size_t p = s.find(c, from); return p == std::string::npos ? -1 : (int)p; }
  String substring(unsigned int a) const { return String(s.substr(a)); }
  String substring(unsigned int a, unsigned int b) const { return String(s.substr(a, b - a)); }
  long toInt() const { return atol(s.c_str()); }
  bool operator==(const char* o) const { return s == o; }
  String& operator+=(char c) { s += c; return *this; }
};
struct SerialSim {
  std::deque<char> in; std::string out;
  void begin(long) {}
  int available() { return in.size(); }
  int read() { char c = in.front(); in.pop_front(); return c; }
  void print(const char* x) { out += x; }
  void print(const String& x) { out += x.s; }
  void print(char c) { out += c; }
  void print(long v) { out += std::to_string(v); }
  void print(int v) { out += std::to_string(v); }
  void print(unsigned int v) { out += std::to_string(v); }
  void println(const char* x) { out += x; out += "\n"; }
  void println(long v) { out += std::to_string(v) + "\n"; }
  void println(int v) { out += std::to_string(v) + "\n"; }
  void println(unsigned int v) { out += std::to_string(v) + "\n"; }
  void println(unsigned long v) { out += std::to_string(v) + "\n"; }
  void println(const String& x) { out += x.s + "\n"; }
};
extern SerialSim Serial;
