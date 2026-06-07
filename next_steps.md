We are going to build out the feature for adding a new trip

Basic rules:
- always follow best patterns and newest standards for react and python fast api.
- ui views need to mobile optimized.  Use the established patterns as much as possible. Always favor using material ui components where possible.

- new trip button available at the top right of the trip list
- clicking it takes user to "carousel" of card elements
    - first card: Trip name, start date, end date
    - second card: Travel (first leg of the trip ie the first flight)
    - third card: return travel (final leg)
- after filling out the form in the carouself of cards, make a request to create a new trip
    - initial trip state should have days nodes for each day between and including the start and end date. initial title can just be the day in format "May 12th"
    - make a travel point for the departing and returning travel. 

- after the succesful post call to create the trip, navigate the user to the that trip view. 

Give me the plan for this feature.  We should really only need to change the front end.  But tell me you best option and ask any quesitons you need to 

Fix some UI issues, ask any questions you have before you start

UI Updates:
- on trip list screen; format the dates to be readable in format "June 1st" for example.
- for the new trip flow, we need to default values
    - date for the outbound flight should default to trip start.  default end of outbound to 11pm start date. 
    - date for the return flight should default to trip end date. default end of return to 11pm end date. 
    - end dates need to be after start dates.
    - all dates need to fall within the trip start and end dates.

    
Break down into components:
- look at the models.py file.  Create sub components for Location, TravelDetails, and StayDetails. These will be included in the larger trip point form
- create trip point form.  
- For now let's expose ui elements based on the endpoint schemas.  
- parent context is going to feed the form the day id and trip id. 



We need to update the location form to make it easier to use

- I will add a google maps api key. The key will be returned with the auth call.
- I want to use the new google places api.  We are going to take the name the user inputs in the form and autocomplete the rest of the form.
- name field should have an mui Grouped autocomplete 
    - header of the group is the citpoy, State or country
    - each item has full address of the search result. 

Give me a plan on what changes are needed.  Ask any questions you have. 

1. User the autocomplete please 
2. Make the calls to the maps api from the front end.  Create a new service for this, dont mix it into the existing api service
3. yes locality, country makes the most sense, thanks.

ok, I'm realizing an issue with the time inputs. we need to make sure we are storing them in a consistent style

- we need a way for the user translate time zones.  The input for start/end of the trip will possibly be in two timezones. 
- want to see your plan on how to handle this in the simplest manner. some things I'm thinking
    - do we want trip settings page? where user can set the home and destination time zones? 
    - should we make the timezone set explicitly in the points form? Could default it.
    - do we want to seperate out timezones to another table as a trip could have multiple.
    - should we store the timezone or does it make more sense to just translate everything to UTC in the api? making timezone a front end issue. 

Give me you plan before any changes.  Ask any questions you need to.


It looks like the timezones are still causing some issues.  I want the datatimes to be in the format 2026-05-11T14:15:00+02:00 across the system. the GMT +2:00 is what should set the time zone for any ui labels.  Does that make sense? Ask any questions you have.

ok it looks like times are being recorded but labels are sit


There is still an issue with parsing between the UTC offset and the timezone.  So we are going to simplify this with a constant list we can just look up from.  Make the list based on this map:

UTC 0:  