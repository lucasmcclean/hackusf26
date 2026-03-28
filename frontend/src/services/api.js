const BASE_URL = 'http://localhost:8000/'
const ENDPOINTS = {
    CREATE_USER: ''
}

export const createUser = (user) => {
    const URL = `${BASE_URL}${ENDPOINTS.CREATE_USER}`
    return fetch({
        method: 'POST',
        cache: 'no-cache',
        headers: {
        'Content-Type': 'application/json',
        },
        body: JSON.stringify({URL})
    })
}