

New trip flow

Intent: we want to build a conversational workflow so the user can easily create a new trip without too much work. We are going to present the user a chat ui, that will allow the user to send questions and responses to the openai agent, which will build their trip itinerary through the discussion. 

Dependencies:
- no existing trip is required.

Context for agentic flow:
Overall agent flow
	- tone has to be warm, and helpful.  remember you are helping set up a vacation so it should be fun. After every following point, the existing trip state should be saved.
	- Welcome step (creates the trip record)
		- prompt for existing itinerary (xlsx, )
		- if no existing document where are we starting, where are we going.  What are the trip dates?
			- use the destination location as the trips default timezone
			- once info is collected.  create the trip record and empty days for each of the days the trip covers.
	- give us the travel info (add travel details to trip record)
		- If no travel information is found prompt for travel docs
		- if no doc, ask for any travel info (airlines, dates, etc)
		- upload a pdf with flight confirmation
		- confirm the imported travel
	- Give us your stays (adds stay details to the trip record)
		- If no stays are found, prompt for the document
		- If no doc, ask for any information about the hotel (name, city/state/country, approx check in/out)
		- upload document
		- confirm the imported stay information
	- At this point we have the trip record, travel details, and stay details. Show the user the summary of their trip "import"
	- run the verification on the trip and land the user on the inspection screen (for now) - we add more here later
	- For now give the user the option to only upload one travel and one stay document. 

phase 0: setup relationships & expose docs

Backend Changes:

Create associations between travel/stays and trip points
- adding a travel detail to the trip should insert two points in the trip.  One is the departure event and the other the arrival event.
- adding a stay detail to the trip with insert two points in the trip. One is check in event the other check out.  
	- default for check in time is 4pm
	- default for check out time is 11am
- deleting a travel or stay should also delete the associated points.
Our models should be set up to support this, we just don't have the python code to handle it.  Stop and let me know if thats not true and let's talk through options.

UI changes:
Create a document list screen.
- On the document importer screen, show a list of previous imported documents. 
- Make sure this is feasible. I want a button for "regen details" and this will pull the objects we extracted from the upload from the database. do reprocess the file with open ai.

Phase 1: Build chat
we need to build the base of a chat or conversational interface.

Backend chat:
- new model for a chat message
	- message
	- timestamp (utc) 
	- user_id
	- trip_id
	- flag or field to distinguish a bot message
Frontend chat: Build the chat interface
- Add floating action button to bottom right with a chat bubble icon. This is only available when you are  on the home screen for now.
- clicking that will pop up a chat window. this is a full screen overlay like our forms. so include the x button as well.
- chat window will show messages from ai on the left and then messages from the user on the right. 
- chat message record needs to be created when a user submits a message, a record is also created when the ai responds.
- chat api endpoint needs to be stubbed. just have it return hello world with the date anytime it is called.
- when the chat window is opened it needs to set a variable for workflow context.  In this current case, the workflow name should be "new_trip" (or suggest a better name or format).  this will let the backend know to route the chat to the prompt for the appropriate agent context. 

Questions:
- can we track the session id with the open ai api. Is there any advantage to that? 

Phase 2: Conversation workflow

Backend changes
- create new prompt for the ai agent "new trip" workflow.
	- agent prompt needs to keep the agents scope specifically to completing the users itinerary.
- agent needs to be able to create and update the trips models (points, stays, travel).  agent will also need to save the model in between any steps.
- we are going to eventually have agentic workflows, but now let's just do the basic "new trip" workflow mentioned above.  think about how we would structure more workflows in the end.



Phase 3: Update Errors and Inspection page
we want to add some error cases. The inspection page is really helpful at the moment so the new trip convo flow should land there.

new errors:
- TRAVEL_OUTOFBOUNDS & STAY_OUTOFBOUNDS
	- thrown if the start or end dates fall either before the start of the trip or after the end of the trip. throw an error for each case that is tripped
- TRAVEL_OVERLAP & STAY_OVERLAP
	- travel error thrown when one travel details has a departure time that is before any preceeding arrival times. ie the plane you are in lands after the next leg of your traveling takes off.
	- stay - when the check in date is earlier than the previous check out date.


Ask any questions you have.  I know this is a lot so if you have questions lets talk through them phase by phase.  Once we have all the questions answered and agree on a plan you can implement the phases all at once.


Phase 0
Should generated travel/stay points be marked in some way so we can distinguish them from user-authored points later?
If a user edits a travel or stay time later, should the linked generated points auto-update to stay in sync?
On delete, do you want linked generated points soft-deleted only, or hard-deleted?
Phase 1
Should chat be allowed only for trips already created, or should opening chat with no trip create a temporary draft trip immediately?
Do you want one chat thread per trip, or one thread per trip plus workflow name?
Phase 2
For the welcome step, if the user uploads an existing itinerary document first, should that bypass most of the chat and just move to confirmation?
For “starting location” and “destination,” do you want these stored only as conversational context for now, or persisted onto trip metadata?
For the manual travel/stay fallback, how incomplete can the user be before we stop and ask follow-ups?
Phase 3
For overlap checks, should equality be allowed?
Example: arrival at 14:00, next departure at 14:00.
For stay overlap, should same-day checkout at 11:00 and next check-in at 16:00 be considered clean even if dates are the same? My assumption is yes.




When user hits send the input box needs to clear out and the users chat bubble should show immediately.  Have a bubble with "..." in the ui and then replace it the bots response. 

Hitting enter needs to send the message.

Tweak the ai response a little. In general make it tighter and more readable.  remember the point of the integration is really to have open ai take the unstructured natural language and create our trip schema from it.  On every turn, we should try to pull structured info, and then save the updated info to the trip. let's make a new column in the chat message. this column will be "structure_content" and it will store any of the structured content the api returns to us, so bot only rows will be populated. 

Have the ai call out the requested info more clearly.  Put it in bulleted list like:
- where are we going?
- when do we leave?
- when do we return?

year should default to 2026.
have openai give the trip a name, based on the destination.