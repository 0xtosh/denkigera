let homeData = {
    rooms: []
};
let refreshInterval;

const API_BASE_URL = '/api';

async function fetchAndProcessDevices() {
        // Fetch devices from API and prepare data structures
        const response = await fetch(`${API_BASE_URL}/devices`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const apiDevices = await response.json();
        // Find the gateway first to update the header and status row
        const gateway = apiDevices.find(d => d.type === 'gateway');
        if (gateway) {
            updateHeader(gateway);
        }
        // Filter for devices that have a room and are a type we want to display
        const relevantDevices = apiDevices.filter(d => ['light', 'blinds', 'controller'].includes(d.type) && d.room);
        // Group devices by room.id for uniqueness
        const roomsMap = new Map();
    try {
        // Get existing open/closed states to preserve them on refresh
        const existingRoomStates = new Map();
        homeData.rooms.forEach(room => {
            existingRoomStates.set(room.id, room.isOpen);
        });

        relevantDevices.forEach(device => {
            const roomObj = device.room;
            if (!roomObj) return;
            // Debug: log each room object and its name/icon
            console.log('[ROOM DEBUG]', roomObj);
            const roomId = roomObj.id;
            if (!roomsMap.has(roomId)) {
                const mappedIcon = mapIcon(roomObj.icon);
                console.log(`[ROOM DEBUG] Creating room section: name='${roomObj.name}', icon='${roomObj.icon}', mappedIcon='${mappedIcon}'`);
                roomsMap.set(roomId, {
                    id: roomId,
                    name: roomObj.name,
                    color: mapColor(roomObj.name), // Use room name for color mapping
                    icon: mappedIcon,
                    isOpen: existingRoomStates.has(roomId) ? existingRoomStates.get(roomId) : true,
                    devices: [],
                    controllers: []
                });
            }
            const room = roomsMap.get(roomId);
            const transformedDevice = transformDeviceData(device);
            if (device.type === 'light' || device.type === 'blinds') {
                room.devices.push(transformedDevice);
            } else if (device.type === 'controller') {
                room.controllers.push(transformedDevice);
            }
        });

        // Sort devices and controllers within each room
        roomsMap.forEach(room => {
            room.devices.sort(deviceSorter);
            room.controllers.sort(deviceSorter);
        });

        homeData.rooms = Array.from(roomsMap.values());
        renderRooms();

    } catch (error) {
        console.error("Failed to fetch or process devices:", error);
        document.getElementById('rooms-container').innerHTML = `<p class="text-red-500 p-4">Error loading devices. Is the backend server running?</p>`;
        // Also update the status dot on error
        const statusDot = document.getElementById('gateway-status-dot');
        if (statusDot) {
            statusDot.classList.remove('bg-green-500', 'bg-gray-500');
            statusDot.classList.add('bg-red-500');
        }
    }
}

async function updateDevice(deviceId, attributesPayload) {
    console.log(`Updating device ${deviceId} with payload:`, attributesPayload);
    try {
        // The backend expects a body with an "attributes" key
        const body = { attributes: attributesPayload };

        await fetch(`${API_BASE_URL}/devices/${deviceId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
    } catch (error) {
        console.error(`Failed to update device ${deviceId}:`, error);
    }
}


function updateHeader(gateway) {
    console.log("DEBUG: Received gateway object:", gateway); // Debugging line
    const statusDot = document.getElementById('gateway-status-dot');
    const sunriseTimeEl = document.getElementById('sunrise-time');
    const sunsetTimeEl = document.getElementById('sunset-time');

    if (statusDot) {
        statusDot.classList.toggle('bg-green-500', gateway.isReachable);
        statusDot.classList.toggle('bg-red-500', !gateway.isReachable);
    }

    // Safely access nested properties
    if (sunriseTimeEl && gateway.attributes && gateway.attributes.nextSunRise) {
        const sunriseDate = new Date(gateway.attributes.nextSunRise);
        sunriseTimeEl.textContent = sunriseDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } else {
        console.log("DEBUG: Sunrise time not found in gateway attributes.");
    }

    if (sunsetTimeEl && gateway.attributes && gateway.attributes.nextSunSet) {
        const sunsetDate = new Date(gateway.attributes.nextSunSet);
        sunsetTimeEl.textContent = sunsetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } else {
        console.log("DEBUG: Sunset time not found in gateway attributes.");
    }

    // --- Gateway Info Footer ---
    // Remove any existing footer
    let oldFooter = document.getElementById('gateway-info-footer');
    if (oldFooter) oldFooter.remove();

    // Prepare info
    const model = gateway.model || (gateway.attributes && gateway.attributes.model) || '';
    const firmware = gateway.firmwareVersion || (gateway.attributes && gateway.attributes.firmwareVersion) || '';
    const hardware = gateway.hardwareVersion || (gateway.attributes && gateway.attributes.hardwareVersion) || '';
    let latitude, longitude;
    if (gateway.attributes && gateway.attributes.coordinates) {
        latitude = gateway.attributes.coordinates.latitude;
        longitude = gateway.attributes.coordinates.longitude;
        console.log('[GATEWAY FOOTER DEBUG] Found coordinates in gateway.attributes.coordinates:', latitude, longitude);
    } else if (gateway.coordinates) {
        latitude = gateway.coordinates.latitude;
        longitude = gateway.coordinates.longitude;
        console.log('[GATEWAY FOOTER DEBUG] Found coordinates in gateway.coordinates:', latitude, longitude);
    } else {
        latitude = undefined;
        longitude = undefined;
        console.log('[GATEWAY FOOTER DEBUG] No coordinates found.');
    }

    // Only show if at least one value exists
    if (model || firmware || hardware || (latitude && longitude)) {
        const footer = document.createElement('div');
        footer.id = 'gateway-info-footer';
        footer.style.fontSize = '0.75rem';
        footer.style.color = '#fff';
        footer.style.textAlign = 'center';
        footer.style.margin = '0.7rem 0 0.5rem 0'; // Reduced top margin
        footer.style.opacity = '0.85';
        footer.style.letterSpacing = '0.02em';
        footer.style.fontFamily = "'Google Sans', sans-serif";

        let html = '';
        if (model) html += `<span style="margin-right:1.5em;">Model: <span style='color:#fff;'>${model}</span></span>`;
        if (firmware) html += `<span style="margin-right:1.5em;">Firmware: <span style='color:#fff;'>${firmware}</span></span>`;
        if (hardware) html += `<span style="margin-right:1.5em;">Hardware: <span style='color:#fff;'>${hardware}</span></span>`;
        if (latitude && longitude) {
            const mapsUrl = `https://www.google.com/maps/place/${latitude},${longitude}`;
            console.log('[GATEWAY FOOTER DEBUG] Adding location link:', mapsUrl);
            html += `<a href="${mapsUrl}" target="_blank" style="color:#fff; margin-left:0.5em;">
                <i class="fa-solid fa-globe" style="font-size:0.9em; margin-right:0.2em;"></i>&nbsp;Location
            </a>`;
        } else {
            console.log('[GATEWAY FOOTER DEBUG] Skipping location link, missing latitude or longitude.');
        }
        footer.innerHTML = html;

        // Insert at end of body
        document.body.appendChild(footer);
    }
}


function transformDeviceData(apiDevice) {
    const { attributes } = apiDevice;
    const device = {
        id: apiDevice.id,
        name: attributes.customName || apiDevice.type,
        type: apiDevice.type,
        available: apiDevice.isReachable,
        on: attributes.isOn,
        value: 0,
    };

    if (device.type === 'light') {
        device.value = attributes.lightLevel || 0;
        if (attributes.colorTemperature) {
            if (attributes.colorTemperature > 3000) device.color = 'white';
            else if (attributes.colorTemperature > 2500) device.color = 'yellow';
            else device.color = 'orange';
        } else {
            device.color = 'yellow';
        }
    } else if (device.type === 'blinds' || device.type === 'controller') {
        device.batteryLevel = attributes.batteryPercentage;
        if (device.type === 'blinds') {
            device.value = attributes.blindsCurrentLevel || 0;
        }
    }
    
    return device;
}

function deviceSorter(a, b) {
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();

    const isALeft = nameA.includes('left');
    const isARight = nameA.includes('right');
    const isBLeft = nameB.includes('left');
    const isBRight = nameB.includes('right');

    // If one has "left" and the other has "right", sort "left" first
    if (isALeft && isBRight) return -1;
    if (isARight && isBLeft) return 1;

    // Otherwise, fall back to alphabetical sorting
    return nameA.localeCompare(nameB, undefined, { numeric: true });
}


function getBatteryIcon(percentage) {
    if (percentage === undefined) return '';
    let iconClass = 'fa-solid ';
    let colorClass = percentage <= 10 ? 'text-red-500' : 'text-gray-400';

    if (percentage > 85) {
        iconClass += 'fa-battery-full';
    } else if (percentage > 60) {
        iconClass += 'fa-battery-three-quarters';
    } else if (percentage > 40) {
        iconClass += 'fa-battery-half';
    } else if (percentage > 15) {
        iconClass += 'fa-battery-quarter';
    } else {
        iconClass += 'fa-battery-empty';
    }
    return `<i class="${iconClass} ${colorClass}"></i>`;
}

const staticColorThemes = [
    { header: '#8DBCD4', text: '#1f2937' },
    { header: '#9FB842', text: '#1f2937' },
    { header: '#FFDD51', text: '#1f2937' },
    { header: '#E3AA3C', text: '#1f2937' },
    { header: '#FFB7B9', text: '#1f2937' },
    { header: '#DC5D65', text: '#ffffff' },
    { header: '#F0DFB5', text: '#1f2937' },
    { header: '#3B6BE0', text: '#ffffff' }
];

let roomColorMap = {};
let colorIndex = 0;

function mapColor(roomName) {
    if (!roomColorMap[roomName]) {
        roomColorMap[roomName] = staticColorThemes[colorIndex % staticColorThemes.length];
        colorIndex++;
    }
    return roomColorMap[roomName];
}

function mapIcon(ikeaIcon) {
    const iconMapping = {
        'rooms_sofa': 'fa-couch',
        'rooms_bed': 'fa-bed',
        'rooms_desk': 'fa-briefcase',
        'rooms_sink': 'fa-bath',
        'rooms_cutlery': 'fa-utensils'
    };
    return iconMapping[ikeaIcon] || 'fa-home';
}


function renderRooms() {
    const container = document.getElementById('rooms-container');
    if (!container) return;
    
    const docFragment = document.createDocumentFragment();

    // Create a grid container for room-groups: 1 col on mobile, 2 on iPad, 3 on large screens
    const roomsGrid = document.createElement('div');
    if (window.innerWidth <= 640) {
        roomsGrid.className = 'grid grid-cols-1 gap-2';
    } else {
        roomsGrid.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3';
    }

    homeData.rooms.forEach((room, roomIndex) => {
        const roomEl = document.createElement('div');
        roomEl.className = 'room-group rounded-2xl overflow-hidden shadow-lg';
        roomEl.style.maxWidth = '480px';
        roomEl.style.margin = '0 auto 1rem auto';
        roomEl.style.width = '100%';

        const roomHeader = document.createElement('div');
    roomHeader.className = `room-header p-4 flex justify-between items-center cursor-pointer border-b border-gray-300 bg-opacity-90`;
    roomHeader.style.backgroundColor = room.color.header;
    roomHeader.style.zIndex = 10;
        // Debug: log what will be rendered for the room header
        console.log(`[RENDER DEBUG] Rendering room header: name='${room.name}', icon='${room.icon}'`);
        // Remove 'fa-' prefix if present in room.icon for correct Font Awesome usage
        let iconClass = room.icon.startsWith('fa-') ? room.icon.slice(3) : room.icon;
        roomHeader.innerHTML = `
            <div class="flex items-center gap-x-3" style="background:transparent;">
                <i class="fa-solid fa-${iconClass} text-2xl"></i>
                <h2 class="text-2xl font-bold" style="color: #000; background:transparent; font-family: 'Google Sans', sans-serif;">${room.name}</h2>
            </div>
            <div class="flex items-center space-x-4">
                <i class="fas fa-power-off text-xl room-toggle-all-icon" data-room-index="${roomIndex}"></i>
                <i class="fas fa-chevron-down transition-transform duration-300 ${room.isOpen ? 'rotate-180' : ''}"></i>
            </div>
        `;

        // Append the header before the content
        roomEl.appendChild(roomHeader);

        const roomContent = document.createElement('div');
        roomContent.className = `room-content ${room.isOpen ? 'open' : ''}`;
        // Set background color and ensure rounded bottom corners
        roomContent.style.backgroundColor = room.color.header;
        roomContent.style.borderBottomLeftRadius = '1rem';
        roomContent.style.borderBottomRightRadius = '1rem';
        if (window.innerWidth <= 640) {
            roomContent.style.paddingLeft = '0';
            roomContent.style.paddingRight = '0';
            roomContent.style.paddingTop = '0.5rem';
            roomContent.style.paddingBottom = '0.5rem';
        } else {
            roomContent.style.padding = '1rem';
        }

        const devicesGrid = document.createElement('div');
        // On mobile, force 1 device card per row; otherwise, 2 per row
        if (window.innerWidth <= 640) {
            devicesGrid.className = 'grid grid-cols-1 gap-1';
        } else {
            devicesGrid.className = 'grid grid-cols-2 gap-2';
        }

        room.devices.forEach((device, deviceIndex) => {
            const deviceCard = document.createElement('div');
            const isOff = !device.on || (device.type === 'blinds' && device.value === 0);
            // Responsive: Use much smaller inline styles for mobile
            let mobileStyle = '';
            if (window.innerWidth <= 640) {
                mobileStyle = 'max-width:90vw;min-width:0;width:90vw;height:50px;margin:0;padding:0.05rem;font-size:0.6rem;line-height:1.1;';
            } else {
                mobileStyle = 'min-width:0;max-width:220px;margin:0 auto;box-sizing:border-box;height:170px;';
            }
            deviceCard.className = `device-card p-2 rounded-lg flex flex-col justify-between ${device.available ? '' : 'unavailable'} ${isOff ? 'off' : ''}`;
            deviceCard.setAttribute('style', mobileStyle);
            let deviceToggleButton, deviceStatus, deviceControls, availabilityStatus;

            if (device.type === 'light') {
                const colorButtonsDisabled = !device.on ? 'disabled' : '';
                const iconFontSize = window.innerWidth <= 640 ? 'font-size:0.7rem;' : '';
                const statusFontSize = window.innerWidth <= 640 ? 'font-size:0.6rem;' : 'font-size:0.75rem;';
                const sliderHeight = window.innerWidth <= 640 ? 'height:2px;' : 'height:8px;';
                const sliderThumb = window.innerWidth <= 640 ? 'width:6px;height:6px;' : '';
                const colorBtnSize = window.innerWidth <= 640 ? 'width:9px;height:9px;min-width:9px;min-height:9px;' : '';
                const innerPad = window.innerWidth <= 640 ? 'padding:0 0.1rem 0 0.1rem;' : '';
                const gap = window.innerWidth <= 640 ? 'gap:0.08rem;' : 'gap:0.3rem;';
                const mt1 = window.innerWidth <= 640 ? 'margin-top:0.08rem;' : 'margin-top:0.25rem;';
                deviceToggleButton = `<button class="device-toggle-btn" data-room-index="${roomIndex}" data-device-index="${deviceIndex}"><i class="fas fa-lightbulb text-xl device-icon" style="${iconFontSize}color: ${device.on ? (device.color === 'white' ? '#a7a7a7' : device.color) : ''}"></i></button>`;
                deviceStatus = `<span class="device-status font-semibold w-12 text-right inline-block" style="${statusFontSize}">${device.on ? `${device.value}%` : 'Off'}</span>`;
                    deviceStatus = `<span class="device-status font-semibold w-12 text-right inline-block device-status-mobile">${device.on ? `${device.value}%` : 'Off'}</span>`;
                availabilityStatus = `<div class="text-xs text-gray-500">${device.available ? 'Available' : 'Not Available'}</div>`;
                deviceControls = `
                    <div class="flex items-center justify-between w-full mb-0" style="${innerPad}">
                        <i class="fa-regular fa-lightbulb text-lg text-gray-400" style="${iconFontSize}"></i>
                        <span></span>
                        <i class="fa-solid fa-lightbulb text-lg text-yellow-400" style="${iconFontSize}"></i>
                    </div>
                    <div class="slider-container mt-0 mb-2 flex items-center justify-center" style="${gap}align-items:center;${window.innerWidth <= 640 ? 'height:12px;' : 'height:36px;'}${innerPad}">
                        <input type="range" min="0" max="100" value="${device.value}" class="slider device-slider custom-black-slider" data-room-index="${roomIndex}" data-device-index="${deviceIndex}" style="width:95%;${sliderHeight}border-radius:8px;outline:none;${sliderThumb}">
                    </div>
                    <div class="flex justify-center space-x-3" style="${mt1}${gap}">
                        <button class="color-btn w-5 h-5 rounded-full bg-white border border-gray-300 ${device.color === 'white' ? 'active' : ''}" data-color="white" data-room-index="${roomIndex}" data-device-index="${deviceIndex}" ${colorButtonsDisabled} style="${colorBtnSize}"></button>
                        <button class="color-btn w-5 h-5 rounded-full bg-yellow-200 ${device.color === 'yellow' ? 'active' : ''}" data-color="yellow" data-room-index="${roomIndex}" data-device-index="${deviceIndex}" ${colorButtonsDisabled} style="${colorBtnSize}"></button>
                        <button class="color-btn w-5 h-5 rounded-full bg-orange-300 ${device.color === 'orange' ? 'active' : ''}" data-color="orange" data-room-index="${roomIndex}" data-device-index="${deviceIndex}" ${colorButtonsDisabled} style="${colorBtnSize}"></button>
                    </div>
                `;
            } else if (device.type === 'blinds') {
                const blindsIconClass = device.value > 0 ? 'fa-solid fa-square' : 'fa-regular fa-square';
                const iconFontSize = window.innerWidth <= 640 ? 'font-size:0.7rem;' : '';
                const statusFontSize = window.innerWidth <= 640 ? 'font-size:0.6rem;' : 'font-size:0.75rem;';
                const iconStyle = device.value > 0 ? `style=\"color:#374151;${iconFontSize}\"` : `style=\"${iconFontSize}\"`;
                const innerPad = window.innerWidth <= 640 ? 'padding:0 0.1rem 0 0.1rem;' : '';
                const gap = window.innerWidth <= 640 ? 'gap:0.08rem;' : 'gap:0.3rem;';
                deviceToggleButton = `<button class=\"device-toggle-btn\" data-room-index=\"${roomIndex}\" data-device-index=\"${deviceIndex}\"><i class=\"${blindsIconClass} text-xl device-icon\" ${iconStyle}></i></button>`;
                deviceStatus = `<span class=\"device-status font-bold w-16 text-right inline-block\" style=\"${statusFontSize}\">${device.value === 0 ? 'Up' : (device.value === 100 ? 'Down' : `${device.value}% Down`)}</span>`;
                    deviceStatus = `<span class=\"device-status font-bold w-16 text-right inline-block device-status-mobile\">${device.value === 0 ? 'Up' : (device.value === 100 ? 'Down' : `${device.value}% Down`)}</span>`;
                availabilityStatus = `
                    <div class=\"text-xs flex items-center gap-x-2 text-gray-500\">
                        <span>${device.available ? 'Available' : 'Not Available'}</span>
                        ${getBatteryIcon(device.batteryLevel)}
                    </div>`;
                deviceControls = `
                    <div class=\"flex items-center justify-between w-full mb-0\" style=\"${innerPad}\">
                        <i class=\"fa-regular fa-square text-lg text-gray-400\" style=\"${iconFontSize}\"></i>
                        <span></span>
                        <i class=\"fa-solid fa-square text-lg text-gray-700\" style=\"${iconFontSize}\"></i>
                    </div>
                    <div class=\"slider-container mt-0 mb-2 flex items-center justify-center\" style=\"${gap}align-items:center;${window.innerWidth <= 640 ? 'height:12px;' : 'height:36px;'}${innerPad}\">
                        <input type=\"range\" min=\"0\" max=\"100\" value=\"${device.value}\" class=\"slider device-slider custom-black-slider\" data-room-index=\"${roomIndex}\" data-device-index=\"${deviceIndex}\" style=\"width:95%;${window.innerWidth <= 640 ? 'height:3px;' : 'height:8px;'}border-radius:8px;outline:none;${window.innerWidth <= 640 ? 'width:8px;height:8px;' : ''}\">
                    </div>
                `;
    // Add custom style for black slider ring and thumb if not already present
    if (!document.getElementById('custom-black-slider-style')) {
        const style = document.createElement('style');
        style.id = 'custom-black-slider-style';
        style.innerHTML = `
        input[type=range].custom-black-slider {
            accent-color: #000 !important;
        }
        input[type=range].custom-black-slider:focus {
            outline: none !important;
            box-shadow: 0 0 0 4px #000 !important;
        }
        input[type=range].custom-black-slider::-webkit-slider-thumb {
            background: #000 !important;
            border: 2px solid #000 !important;
        }
        input[type=range].custom-black-slider::-moz-range-thumb {
            background: #000 !important;
            border: 2px solid #000 !important;
        }
        input[type=range].custom-black-slider::-ms-thumb {
            background: #000 !important;
            border: 2px solid #000 !important;
        }
        `;
        document.head.appendChild(style);
    }
            }

            // For mobile, remove inline-block and add ellipsis/nowrap/overflow for info elements inside device-cards
            // Remove static min-width and width styles from device name and status
            let infoDivStyle = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
            deviceCard.innerHTML = `
                <div class="flex justify-between items-start">
                    <div style="${infoDivStyle}">
                        <div class="font-bold device-name-mobile" style="font-family:'Google Sans',sans-serif;color:#222;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;">${device.name}</div>
                        <div class="device-availability-mobile" style="color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${availabilityStatus}</div>
                    </div>
                    <div class="flex items-center justify-end gap-x-1" style="${infoDivStyle}">
                        <span style="color:#222;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;"><span class="device-status-mobile">${deviceStatus}</span></span>
                        ${deviceToggleButton}
                    </div>
                </div>
                <div class="mt-2">
                    ${deviceControls}
                </div>
            `;

            if (!device.available) {
                 deviceCard.querySelector('.device-icon').style.color = '#9ca3af';
            }

            devicesGrid.appendChild(deviceCard);
        });

        roomContent.appendChild(devicesGrid);

        // Add the controllers list if any exist for this room
        if (room.controllers && room.controllers.length > 0) {
            const controllersListContainer = document.createElement('div');
            controllersListContainer.className = 'mt-6 pt-4 border-t border-gray-200';

            // Make the Controllers section title black
            const listTitle = document.createElement('h4');
            listTitle.className = 'text-xs font-bold uppercase mb-2';
            listTitle.style.color = '#000';
            listTitle.textContent = 'Controllers';
            controllersListContainer.appendChild(listTitle);

            const listElement = document.createElement('ul');
            listElement.className = 'space-y-2';

            room.controllers.forEach(controller => {
                const listItem = document.createElement('li');
                listItem.className = 'flex items-center gap-x-2 text-sm';
                // Determine battery color: red if <=10, else black
                const batteryIsLow = controller.batteryLevel !== undefined && controller.batteryLevel <= 10;
                const batteryColor = batteryIsLow ? 'red' : 'black';
                // Battery icon: override color if low
                let batteryIconHtml;
                if (controller.batteryLevel === undefined) {
                    batteryIconHtml = '';
                } else if (batteryIsLow) {
                    batteryIconHtml = `<i class="fa-solid fa-battery-empty" style="color: #ef4444; margin-left: 0.2em;"></i>`;
                } else {
                    let iconClass = 'fa-solid ';
                    if (controller.batteryLevel > 85) {
                        iconClass += 'fa-battery-full';
                    } else if (controller.batteryLevel > 60) {
                        iconClass += 'fa-battery-three-quarters';
                    } else if (controller.batteryLevel > 40) {
                        iconClass += 'fa-battery-half';
                    } else if (controller.batteryLevel > 15) {
                        iconClass += 'fa-battery-quarter';
                    } else {
                        iconClass += 'fa-battery-empty';
                    }
                    batteryIconHtml = `<i class="${iconClass}" style="color: #000; margin-left: 0.2em;"></i>`;
                }
                // Combine name, battery %, and icon in one row, same font
                listItem.innerHTML = `
                    <div class="flex items-center gap-x-1">
                        <i class="fa-solid fa-mobile-button" style="color: #000;"></i>
                        <span style="color: #000; font-family: 'Google Sans', sans-serif; font-weight: normal;">${controller.name}</span>
                        ${controller.batteryLevel !== undefined ? `<span style="color: ${batteryColor}; font-family: 'Google Sans', sans-serif; font-weight: normal; margin-left: 0.5em;">${controller.batteryLevel}%</span>` : ''}
                        ${batteryIconHtml}
                    </div>
                `;
                listElement.appendChild(listItem);
            });

            controllersListContainer.appendChild(listElement);
            roomContent.appendChild(controllersListContainer);
        }


        roomEl.appendChild(roomContent);
        roomsGrid.appendChild(roomEl);

        roomHeader.addEventListener('click', (e) => {
            if (!e.target.classList.contains('room-toggle-all-icon')) {
                homeData.rooms[roomIndex].isOpen = !homeData.rooms[roomIndex].isOpen;
                renderRooms(); 
            }
        });
    });
    
    container.innerHTML = '';
    container.appendChild(roomsGrid);

    // After rendering, always remove and re-inject the mobile font size override for device name, status, and availability
    const oldMobileStyle = document.getElementById('device-card-mobile-font-style');
    if (oldMobileStyle) oldMobileStyle.remove();
    const styleMobile = document.createElement('style');
    styleMobile.id = 'device-card-mobile-font-style';
    styleMobile.innerHTML = `
        @media (max-width: 1024px) {
            .device-card .device-name-mobile {
                font-size: 12px !important;
                font-weight: 500 !important;
                font-family: 'Futura', 'Trebuchet MS', 'Segoe UI', Arial, sans-serif !important;
                line-height: 1.15 !important;
            }

            .device-card .device-status-mobile {
                font-size: 0.45em !important;
                font-weight: 500 !important;
                font-family: 'Futura', 'Trebuchet MS', 'Segoe UI', Arial, sans-serif !important;
                line-height: 1.15 !important;
            }
            .device-card .device-availability-mobile {
                font-size: 0.55em !important;
                font-family: 'Futura', 'Trebuchet MS', 'Segoe UI', Arial, sans-serif !important;
                line-height: 1.1 !important;
            }
        }
        @media (max-width: 640px) {
            .device-card .device-status-mobile {
                font-size: 0.45em !important;
                   font-family: 'Futura', 'Trebuchet MS', 'Segoe UI', Arial, sans-serif !important;
            }
            .device-card .device-availability-mobile {
                font-size: 0.7em !important;
                   font-family: 'Futura', 'Trebuchet MS', 'Segoe UI', Arial, sans-serif !important;
            }
        }
    `;
    document.head.appendChild(styleMobile);
    // Remove any font-size or Tailwind font-size classes
    document.querySelectorAll('.device-name-mobile, .device-status-mobile, .device-availability-mobile').forEach(el => {
        el.style.fontSize = '';
        el.classList.remove('text-xl', 'text-2xl', 'text-lg', 'text-base', 'text-sm', 'text-xs', 'font-bold', 'font-semibold');
    });

    addEventListeners();
}

/**
 * Adds event listeners to all interactive controls.
 */
function addEventListeners() {
    // Room toggle all
    document.querySelectorAll('.room-toggle-all-icon').forEach(icon => {
        icon.addEventListener('click', async (e) => {
            const clickedIcon = e.target;
            // Prevent re-clicking while processing
            if (clickedIcon.classList.contains('fa-spinner')) {
                return;
            }

            // Show loading state
            clickedIcon.classList.remove('fa-power-off');
            clickedIcon.classList.add('fa-spinner', 'fa-spin');

            e.stopPropagation();
            const roomIndex = clickedIcon.dataset.roomIndex;
            const room = homeData.rooms[roomIndex];
            const turnOn = room.devices.some(d => d.available && !d.on);
            
            const devicesToUpdate = room.devices.filter(d => d.available);

            // Send commands sequentially to prevent overwhelming the hub
            for (const device of devicesToUpdate) {
                const newValue = turnOn ? 100 : 0;
                const payload = device.type === 'light' ? { isOn: turnOn, lightLevel: newValue } : { blindsTargetLevel: newValue };
                await updateDevice(device.id, payload);
                // Add a small delay between commands for reliability
                await new Promise(resolve => setTimeout(resolve, 150));
            }

            // Refresh the UI after all commands have been sent
            fetchAndProcessDevices();
        });
    });

    // Device toggle button
    document.querySelectorAll('.device-toggle-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const roomIndex = e.currentTarget.dataset.roomIndex;
            const deviceIndex = e.currentTarget.dataset.deviceIndex;
            const device = homeData.rooms[roomIndex].devices[deviceIndex];
            
            const newIsOn = !device.on;
            const newValue = newIsOn ? 100 : 0;
            
            const payload = device.type === 'light' ? { isOn: newIsOn } : { blindsTargetLevel: newValue };
            if(device.type === 'light' && newIsOn) {
                payload.lightLevel = 100;
            }

            updateDevice(device.id, payload);
            
            device.on = newIsOn;
            device.value = newValue;
            renderRooms();
        });
    });

    // Device sliders
    document.querySelectorAll('.device-slider').forEach(slider => {
        let debounceTimer;
        slider.addEventListener('input', (e) => {
            const sliderEl = e.target;
            const roomIndex = sliderEl.dataset.roomIndex;
            const deviceIndex = sliderEl.dataset.deviceIndex;
            const device = homeData.rooms[roomIndex].devices[deviceIndex];
            const newValue = parseInt(sliderEl.value);

            // Live UI update
            const deviceCard = sliderEl.closest('.device-card');
            const statusSpan = deviceCard.querySelector('.device-status');
            const icon = deviceCard.querySelector('.device-icon');
            if (device.type === 'light') {
                statusSpan.textContent = newValue > 0 ? `${newValue}%` : 'Off';
            } else {
                statusSpan.textContent = newValue === 0 ? 'Up' : (newValue === 100 ? 'Down' : `${newValue}% Down`);
            }
            deviceCard.classList.toggle('off', newValue === 0);
            if (device.type === 'light') {
                deviceCard.querySelectorAll('.color-btn').forEach(btn => btn.disabled = (newValue === 0));
            }
            if (device.type === 'blinds') {
                const newIconClass = newValue > 0 ? 'fa-solid fa-square' : 'fa-regular fa-square';
                icon.className = `${newIconClass} text-2xl device-icon`;
            }

            // Debounce API call
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const payload = device.type === 'light' ? { lightLevel: newValue } : { blindsTargetLevel: newValue };
                updateDevice(device.id, payload);
            }, 250);
        });
    });

    // Color buttons
    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const roomIndex = e.target.dataset.roomIndex;
            const deviceIndex = e.target.dataset.deviceIndex;
            const color = e.target.dataset.color;
            const device = homeData.rooms[roomIndex].devices[deviceIndex];

            let temp;
            if (color === 'white') temp = 4000;
            else if (color === 'yellow') temp = 2700;
            else temp = 2200;

            // Send current lightLevel along with colorTemperature to maintain brightness
            updateDevice(device.id, { colorTemperature: temp, lightLevel: device.value });
            
            device.color = color;
            renderRooms();
        });
    });
}

// Initial load
document.addEventListener('DOMContentLoaded', () => {
    fetchAndProcessDevices();
    refreshInterval = setInterval(fetchAndProcessDevices, 10000); // Refresh every 10 seconds
    // Re-render rooms on resize to apply correct mobile/desktop styles
    window.addEventListener('resize', () => {
        if (homeData.rooms && homeData.rooms.length > 0) {
            renderRooms();
        }
    });
});
