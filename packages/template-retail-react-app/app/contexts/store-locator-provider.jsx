/*
 * Copyright (c) 2024, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import React, {useState, createContext} from 'react'
export const StoreLocatorContext = createContext(null)

export const StoreLocatorProvider = ({config, children}) => {
    const [state, setState] = useState({
        mode: 'input',
        formValues: {
            countryCode: config.defaultCountryCode,
            postalCode: config.defaultPostalCode
        },
        deviceCoordinates: {
            latitude: null,
            longitude: null
        },
        config
    })

    const value = {
        state,
        setState
    }

    return <StoreLocatorContext.Provider value={value}>{children}</StoreLocatorContext.Provider>
}
