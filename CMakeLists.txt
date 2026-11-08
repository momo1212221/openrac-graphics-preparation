cmake_minimum_required(VERSION 3.20)
project(openrac_graphics_effects_runtime LANGUAGES C CXX)

if(NOT OpenRACMod_DIR)
  if(DEFINED OPENRAC_SDK)
    set(OpenRACMod_DIR "${OPENRAC_SDK}/cmake")
  elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/sdk.lock")
    file(READ "${CMAKE_CURRENT_SOURCE_DIR}/sdk.lock" lock)
    string(JSON sdk_version GET "${lock}" version)
    set(OpenRACMod_DIR "${CMAKE_CURRENT_SOURCE_DIR}/.sdk/openrac-mod-sdk-${sdk_version}/cmake")
  endif()
endif()
find_package(OpenRACMod 1.14 REQUIRED)

openrac_add_mod(
  graphics_effects_runtime
  MANIFEST effects-runtime/openrac-mod.json
  SOURCES effects-runtime/src/mod.cpp
)
