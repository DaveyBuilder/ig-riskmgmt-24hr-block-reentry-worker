import { loginIG } from './helper_functions/login_ig.js';
import { getOpenPositions } from './helper_functions/open_positions.js';
import { getClosedTrades } from './helper_functions/closed_trades.js';
import {isMarketOpen} from './helper_functions/is_market_open.js';
import { closePosition } from './helper_functions/close_position.js';

export async function executeScheduledTask(request, env, ctx, usingDemoAccount) {
    
    let baseURL;
    if (usingDemoAccount) {
        baseURL = 'https://demo-api.ig.com/gateway/deal';
    } else {
        baseURL = 'https://api.ig.com/gateway/deal';
    }

    const { CST, X_SECURITY_TOKEN } = await loginIG(env, baseURL);

    // Check if nasdaq 100 futures are open & exit if not
	const marketStatus = await isMarketOpen(env, CST, X_SECURITY_TOKEN, baseURL);
	if (marketStatus === "EDITS_ONLY") {
		return;
	}

    const openPositionsData = await getOpenPositions(env, CST, X_SECURITY_TOKEN, baseURL);

    let openPositions = {};

    openPositionsData.positions.forEach(position => {
        const instrumentName = position.market.instrumentName;
        if (openPositions[instrumentName]) {
            openPositions[instrumentName].positions.push(position);
        } else {
            openPositions[instrumentName] = { positions: [position] };
        }
    });

    const closedPositions = await getClosedTrades(env, 12);

    let positionsWithin24Hours = [];

    for (const instrument in openPositions) {
        // If there are closed positions for this instrument
        if (closedPositions[instrument]) {
            // Convert the closedDateUtc of each closed position to a Date object
            const closedPositionsClosedDates = closedPositions[instrument].map(p => new Date(p.closedDateUtc));
    
            // Get the positions for the current instrument
            const positions = openPositions[instrument].positions;
            // Convert the createdDateUTC of each position to a Date object
            const openDates = positions.map(p => new Date(p.position.createdDateUTC));
    
            // Compare each open position date with every closed position date
            for (let i = 0; i < openDates.length; i++) {
                for (let j = 0; j < closedPositionsClosedDates.length; j++) {
                    const diff = openDates[i] - closedPositionsClosedDates[j];
    
                    // If difference <= 12 hours and the open position was created after the closed position
                    if (diff <= 12 * 60 * 60 * 1000 && diff >= 0) {
                        // Check if the position is not already in the positionsToClose array
                        if (!positionsWithin24Hours.some(p => p === positions[i])) {
                            // Add the position to the positionsToClose array
                            positionsWithin24Hours.push(positions[i]);
                        }
                    }
                }
            }
        }
    }

    
    // Create the array that contains the details needed for closure
    const positionsToClose = [];
    for (const item of positionsWithin24Hours) {
        if (item.market.marketStatus === "TRADEABLE") {
            const positionDetailsForClosure = {
                dealId: item.position.dealId,
                epic: null,
                expiry: null,
                direction: item.position.direction === "BUY" ? "SELL" : "BUY",
                size: String(item.position.size),
                level: null,
                orderType: "MARKET",
                timeInForce: "FILL_OR_KILL",
                quoteId: null,
            };
            positionsToClose.push(positionDetailsForClosure);
        }
    }

    // Now close each position in positionsToClose

    // Iterate over positionsToClose and make a request for each
    let closedPositionsErrors = [];
    for (const position of positionsToClose) {
        try {
            await closePosition(env, CST, X_SECURITY_TOKEN, baseURL, position);
        } catch (error) {
            closedPositionsErrors.push(error);
        }
    }

    if (closedPositionsErrors.length > 0) {
        throw new Error(`Failed to close positions: ${closedPositionsErrors.map(error => error.message).join(", ")}`);
    }

}