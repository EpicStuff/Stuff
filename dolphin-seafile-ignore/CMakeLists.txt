cmake_minimum_required(VERSION 3.20)

project(dolphin-seafile-ignore VERSION 0.1.2 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_AUTOMOC ON)

find_package(ECM 6.0 REQUIRED NO_MODULE)
list(APPEND CMAKE_MODULE_PATH ${ECM_MODULE_PATH})

include(KDEInstallDirs)
include(KDECMakeSettings)
include(KDECompilerSettings NO_POLICY_SCOPE)

find_package(Qt6 REQUIRED COMPONENTS Core Widgets)
find_package(KF6 REQUIRED COMPONENTS CoreAddons KIO)
find_package(SQLite3 REQUIRED)

kcoreaddons_add_plugin(seafileignoreaction
	SOURCES
		seafileignoreaction.cpp
		seafileignoreaction.h
	INSTALL_NAMESPACE "kf6/kfileitemaction"
)


target_link_libraries(seafileignoreaction PRIVATE
	Qt6::Core
	Qt6::Widgets
	KF6::CoreAddons
	KF6::KIOWidgets
	SQLite3::SQLite3
)
